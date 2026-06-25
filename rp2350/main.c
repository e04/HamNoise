#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "denoise_audio.h"
#include "cw_model_weights.h"
#include "voice_model_weights.h"
#include "hardware/adc.h"
#include "hardware/gpio.h"
#include "hardware/pwm.h"
#include "hardware/sync.h"
#include "pico/stdlib.h"
#include "pico/time.h"

/* RP2350 runtime configuration: change these constants for your board/wiring. */
#define APP_ADC_GPIO 26

#if APP_ADC_GPIO >= 40
#define APP_ADC_INPUT (APP_ADC_GPIO - 40)
#else
#define APP_ADC_INPUT (APP_ADC_GPIO - 26)
#endif

#define APP_PWM_GPIO 15

#define APP_BUTTON_GPIO 14

#define APP_LED_GPIO 12

#define APP_INPUT_GAIN 1.0f

#define APP_OUTPUT_GAIN 1.0f

#define APP_ADC_MIDPOINT 2048.0f

#define APP_DC_BLOCK_ALPHA 0.995f

#define APP_PWM_WRAP 2047u

#define APP_DEBUG_LOG 0

#define APP_DEBUG_INTERVAL_MS 1000u

#define APP_BUTTON_DEBOUNCE_MS 50u

#define APP_BUTTON_LONG_PRESS_MS 500u

#define APP_LED_PWM_WRAP 255u

#define APP_LED_CW_BLINK_MS 500u

#define APP_LED_VOICE_SINE_PERIOD_MS 1200u

#define APP_INPUT_BLOCKS 3u
#define APP_OUTPUT_BLOCKS 4u
#define APP_SAMPLE_PERIOD_US (1000000u / DENOISE_SAMPLE_RATE)
#define APP_SAMPLE_PERIOD_REMAINDER_US (1000000u % DENOISE_SAMPLE_RATE)
#define APP_HOP_BUDGET_US ((1000000u * DENOISE_HOP_LENGTH) / DENOISE_SAMPLE_RATE)
#define APP_LED_TWO_PI 6.28318530717958647692f

#if APP_SAMPLE_PERIOD_US == 0
#error "DENOISE_SAMPLE_RATE is too high for the microsecond timer scheduler"
#endif

#if APP_LED_CW_BLINK_MS == 0
#error "APP_LED_CW_BLINK_MS must be greater than zero"
#endif

#if APP_LED_VOICE_SINE_PERIOD_MS == 0
#error "APP_LED_VOICE_SINE_PERIOD_MS must be greater than zero"
#endif

#if APP_BUTTON_LONG_PRESS_MS <= APP_BUTTON_DEBOUNCE_MS
#error "APP_BUTTON_LONG_PRESS_MS must be greater than APP_BUTTON_DEBOUNCE_MS"
#endif

typedef enum {
    APP_MODE_OFF = 0,
    APP_MODE_CW,
    APP_MODE_VOICE,
    APP_MODE_COUNT
} app_mode_t;

static denoise_stream_t s_stream;
static app_mode_t s_mode = APP_MODE_OFF;
static app_mode_t s_selected_mode = APP_MODE_CW;

#if APP_LED_GPIO >= 0
static bool s_led_available;
static bool s_led_pwm_enabled;
static uint16_t s_led_pwm_wrap;
#endif

static float s_input_blocks[APP_INPUT_BLOCKS][DENOISE_HOP_LENGTH];
static volatile uint32_t s_input_ready_mask;
static volatile uint32_t s_input_overruns;
static volatile uint32_t s_input_dropped_samples;
static volatile uint s_input_fill_block;
static volatile uint s_input_fill_pos;
static volatile bool s_input_dropping;

static float s_output_blocks[APP_OUTPUT_BLOCKS][DENOISE_HOP_LENGTH];
static volatile uint32_t s_output_ready_mask;
static volatile uint32_t s_output_underruns;
static volatile uint32_t s_output_overruns;
static volatile uint s_output_play_block;
static volatile uint s_output_play_pos;
static volatile uint s_output_write_block;

static volatile uint32_t s_sample_ticks;
static uint32_t s_sample_period_error;
static float s_dc_prev_x;
static float s_dc_prev_y;

#if APP_DEBUG_LOG
static uint32_t s_diag_hops;
static uint32_t s_diag_produced_hops;
static uint32_t s_diag_not_produced_hops;
static uint32_t s_diag_status_errors;
static uint32_t s_diag_budget_misses;
static uint32_t s_diag_process_max_us;
static uint32_t s_diag_queue_max_us;
static uint64_t s_diag_process_total_us;
static uint64_t s_diag_queue_total_us;
static int s_diag_last_status;
static bool s_diag_last_produced;
#endif

static uint32_t app_block_bit(uint block)
{
    return 1u << block;
}

static float app_clampf(float value, float lo, float hi)
{
    if (value < lo) {
        return lo;
    }
    if (value > hi) {
        return hi;
    }
    return value;
}

static const char *app_mode_name(app_mode_t mode)
{
    switch (mode) {
    case APP_MODE_OFF:
        return "off";
    case APP_MODE_CW:
        return "cw";
    case APP_MODE_VOICE:
        return "voice";
    default:
        return "unknown";
    }
}

static const denoise_model_t *app_mode_model(app_mode_t mode)
{
    switch (mode) {
    case APP_MODE_CW:
        return &k_denoise_model;
    case APP_MODE_VOICE:
        return &k_voice_reduction_model;
    case APP_MODE_OFF:
    default:
        return NULL;
    }
}

static float app_adc_to_f32(uint16_t raw)
{
    const float x = ((float)(raw & 0x0fffu) - APP_ADC_MIDPOINT) / APP_ADC_MIDPOINT;
    const float y = (x - s_dc_prev_x) + (APP_DC_BLOCK_ALPHA * s_dc_prev_y);
    s_dc_prev_x = x;
    s_dc_prev_y = y;
    return app_clampf(y * APP_INPUT_GAIN, -1.0f, 1.0f);
}

static uint16_t app_f32_to_pwm(float sample)
{
    const float clamped = app_clampf(sample * APP_OUTPUT_GAIN, -1.0f, 1.0f);
    const float scaled = ((clamped + 1.0f) * 0.5f) * (float)APP_PWM_WRAP;
    return (uint16_t)app_clampf(scaled + 0.5f, 0.0f, (float)APP_PWM_WRAP);
}

static int64_t app_next_sample_delay_us(void)
{
    uint32_t delay = APP_SAMPLE_PERIOD_US;
    s_sample_period_error += APP_SAMPLE_PERIOD_REMAINDER_US;
    if (s_sample_period_error >= DENOISE_SAMPLE_RATE) {
        s_sample_period_error -= DENOISE_SAMPLE_RATE;
        delay += 1u;
    }
    return -(int64_t)delay;
}

static bool app_input_block_is_free(uint block)
{
    return (s_input_ready_mask & app_block_bit(block)) == 0u;
}

static bool app_output_block_is_free(uint block)
{
    return (s_output_ready_mask & app_block_bit(block)) == 0u && s_output_play_block != block;
}

static uint app_find_free_input_block_from_isr(void)
{
    for (uint offset = 1; offset <= APP_INPUT_BLOCKS; ++offset) {
        const uint block = (s_input_fill_block + offset) % APP_INPUT_BLOCKS;
        if (app_input_block_is_free(block)) {
            return block;
        }
    }
    return APP_INPUT_BLOCKS;
}

static void app_capture_sample_from_isr(float sample)
{
    if (s_input_dropping) {
        const uint free_block = app_find_free_input_block_from_isr();
        if (free_block >= APP_INPUT_BLOCKS) {
            ++s_input_dropped_samples;
            return;
        }
        s_input_fill_block = free_block;
        s_input_fill_pos = 0;
        s_input_dropping = false;
    }

    s_input_blocks[s_input_fill_block][s_input_fill_pos++] = sample;
    if (s_input_fill_pos < DENOISE_HOP_LENGTH) {
        return;
    }

    s_input_ready_mask |= app_block_bit(s_input_fill_block);
    const uint free_block = app_find_free_input_block_from_isr();
    s_input_fill_pos = 0;
    if (free_block >= APP_INPUT_BLOCKS) {
        ++s_input_overruns;
        s_input_dropping = true;
    } else {
        s_input_fill_block = free_block;
    }
}

static void app_play_sample_from_isr(void)
{
    float sample = 0.0f;
    const uint32_t bit = app_block_bit(s_output_play_block);
    if ((s_output_ready_mask & bit) != 0u) {
        sample = s_output_blocks[s_output_play_block][s_output_play_pos];
    } else {
        ++s_output_underruns;
    }

    pwm_set_gpio_level(APP_PWM_GPIO, app_f32_to_pwm(sample));

    ++s_output_play_pos;
    if (s_output_play_pos >= DENOISE_HOP_LENGTH) {
        s_output_ready_mask &= ~bit;
        s_output_play_pos = 0;
        s_output_play_block = (s_output_play_block + 1u) % APP_OUTPUT_BLOCKS;
    }
}

static int64_t app_audio_tick(alarm_id_t id, void *user_data)
{
    (void)id;
    (void)user_data;

    const uint16_t raw = adc_read();
    app_capture_sample_from_isr(app_adc_to_f32(raw));
    app_play_sample_from_isr();
    ++s_sample_ticks;

    return app_next_sample_delay_us();
}

static void app_adc_init(void)
{
    adc_init();
    adc_gpio_init(APP_ADC_GPIO);
    adc_select_input(APP_ADC_INPUT);
}

static void app_pwm_init(void)
{
    gpio_set_function(APP_PWM_GPIO, GPIO_FUNC_PWM);
    const uint slice = pwm_gpio_to_slice_num(APP_PWM_GPIO);
    pwm_config cfg = pwm_get_default_config();
    pwm_config_set_clkdiv(&cfg, 1.0f);
    pwm_config_set_wrap(&cfg, (uint16_t)APP_PWM_WRAP);
    pwm_init(slice, &cfg, true);
    pwm_set_gpio_level(APP_PWM_GPIO, APP_PWM_WRAP / 2u);
}

#if APP_LED_GPIO >= 0
static void app_led_set_level(uint16_t level)
{
    if (!s_led_available) {
        return;
    }
    if (s_led_pwm_enabled) {
        pwm_set_gpio_level(APP_LED_GPIO, level);
    } else {
        gpio_put(APP_LED_GPIO, level > 0u ? 1 : 0);
    }
}
#endif

static void app_gpio_init(void)
{
#if APP_LED_GPIO >= 0
    if (APP_LED_GPIO == APP_PWM_GPIO) {
        s_led_available = false;
        s_led_pwm_enabled = false;
        s_led_pwm_wrap = 0;
    } else {
        const uint led_slice = pwm_gpio_to_slice_num(APP_LED_GPIO);
        const uint audio_slice = pwm_gpio_to_slice_num(APP_PWM_GPIO);
        s_led_available = true;
        gpio_set_function(APP_LED_GPIO, GPIO_FUNC_PWM);
        s_led_pwm_enabled = true;
        if (led_slice == audio_slice) {
            s_led_pwm_wrap = (uint16_t)APP_PWM_WRAP;
        } else {
            pwm_config cfg = pwm_get_default_config();
            pwm_config_set_clkdiv(&cfg, 64.0f);
            pwm_config_set_wrap(&cfg, (uint16_t)APP_LED_PWM_WRAP);
            pwm_init(led_slice, &cfg, true);
            s_led_pwm_wrap = (uint16_t)APP_LED_PWM_WRAP;
        }
    }
    app_led_set_level(0);
#endif

#if APP_BUTTON_GPIO >= 0
    gpio_init(APP_BUTTON_GPIO);
    gpio_set_dir(APP_BUTTON_GPIO, GPIO_IN);
    gpio_pull_up(APP_BUTTON_GPIO);
#endif
}

static void app_prefill_output_queue(void)
{
    memset(s_output_blocks, 0, sizeof(s_output_blocks));
    s_output_ready_mask = (1u << APP_OUTPUT_BLOCKS) - 1u;
    s_output_play_block = 0;
    s_output_play_pos = 0;
    s_output_write_block = 0;
}

static void app_wait_and_pop_input(float output[DENOISE_HOP_LENGTH])
{
    static uint next_read_block;

    while (true) {
        while (s_input_ready_mask == 0u) {
            tight_loop_contents();
        }

        const uint32_t irq_state = save_and_disable_interrupts();
        uint block = APP_INPUT_BLOCKS;
        for (uint offset = 0; offset < APP_INPUT_BLOCKS; ++offset) {
            const uint candidate = (next_read_block + offset) % APP_INPUT_BLOCKS;
            if ((s_input_ready_mask & app_block_bit(candidate)) != 0u) {
                block = candidate;
                break;
            }
        }
        if (block >= APP_INPUT_BLOCKS) {
            restore_interrupts(irq_state);
            continue;
        }
        for (size_t i = 0; i < DENOISE_HOP_LENGTH; ++i) {
            output[i] = s_input_blocks[block][i];
        }
        s_input_ready_mask &= ~app_block_bit(block);
        restore_interrupts(irq_state);

        next_read_block = (block + 1u) % APP_INPUT_BLOCKS;
        return;
    }
}

static void app_queue_output(const float input[DENOISE_HOP_LENGTH])
{
    while (!app_output_block_is_free(s_output_write_block)) {
        tight_loop_contents();
    }

    const uint32_t irq_state = save_and_disable_interrupts();
    if (!app_output_block_is_free(s_output_write_block)) {
        ++s_output_overruns;
        restore_interrupts(irq_state);
        return;
    }
    for (size_t i = 0; i < DENOISE_HOP_LENGTH; ++i) {
        s_output_blocks[s_output_write_block][i] = input[i];
    }
    s_output_ready_mask |= app_block_bit(s_output_write_block);
    s_output_write_block = (s_output_write_block + 1u) % APP_OUTPUT_BLOCKS;
    restore_interrupts(irq_state);
}

#if APP_DEBUG_LOG
static void app_record_hop(uint32_t process_us, uint32_t queue_us, int status, bool produced)
{
    ++s_diag_hops;
    s_diag_process_total_us += process_us;
    s_diag_queue_total_us += queue_us;
    if (process_us > s_diag_process_max_us) {
        s_diag_process_max_us = process_us;
    }
    if (queue_us > s_diag_queue_max_us) {
        s_diag_queue_max_us = queue_us;
    }
    if (process_us > APP_HOP_BUDGET_US) {
        ++s_diag_budget_misses;
    }
    if (status != 0) {
        ++s_diag_status_errors;
    }
    if (produced) {
        ++s_diag_produced_hops;
    } else {
        ++s_diag_not_produced_hops;
    }
    s_diag_last_status = status;
    s_diag_last_produced = produced;
}

static void app_reset_diag_interval(void)
{
    s_diag_hops = 0;
    s_diag_produced_hops = 0;
    s_diag_not_produced_hops = 0;
    s_diag_status_errors = 0;
    s_diag_budget_misses = 0;
    s_diag_process_max_us = 0;
    s_diag_queue_max_us = 0;
    s_diag_process_total_us = 0;
    s_diag_queue_total_us = 0;
}
#endif

static void app_update_led(void)
{
#if APP_LED_GPIO >= 0
    const uint32_t now_ms = to_ms_since_boot(get_absolute_time());
    switch (s_mode) {
    case APP_MODE_OFF:
        app_led_set_level(0);
        break;
    case APP_MODE_CW:
        app_led_set_level(((now_ms / APP_LED_CW_BLINK_MS) & 1u) == 0u ? s_led_pwm_wrap : 0u);
        break;
    case APP_MODE_VOICE: {
        const float phase = (float)(now_ms % APP_LED_VOICE_SINE_PERIOD_MS) / (float)APP_LED_VOICE_SINE_PERIOD_MS;
        const float brightness = (sinf(APP_LED_TWO_PI * phase) + 1.0f) * 0.5f;
        app_led_set_level((uint16_t)app_clampf((brightness * (float)s_led_pwm_wrap) + 0.5f, 0.0f, (float)s_led_pwm_wrap));
        break;
    }
    default:
        app_led_set_level(0);
        break;
    }
#endif
}

static void app_set_mode(app_mode_t mode)
{
    if (mode >= APP_MODE_COUNT || mode == s_mode) {
        return;
    }
    if (mode != APP_MODE_OFF) {
        s_selected_mode = mode;
    }
    s_mode = mode;
    denoise_stream_reset(&s_stream);
    app_update_led();
#if APP_DEBUG_LOG
    printf("mode %s\n", app_mode_name(s_mode));
#endif
}

static void app_toggle_selected_mode(void)
{
    if (s_mode == APP_MODE_OFF) {
        app_set_mode(s_selected_mode);
    } else {
        app_set_mode(APP_MODE_OFF);
    }
}

static void app_select_next_mode(void)
{
    s_selected_mode = (s_selected_mode == APP_MODE_CW) ? APP_MODE_VOICE : APP_MODE_CW;
    if (s_mode != APP_MODE_OFF) {
        app_set_mode(s_selected_mode);
    }
#if APP_DEBUG_LOG
    else {
        printf("selected mode %s\n", app_mode_name(s_selected_mode));
    }
#endif
}

static void app_update_mode_button(void)
{
#if APP_BUTTON_GPIO >= 0
    static bool stable_pressed = false;
    static bool last_raw_pressed = false;
    static bool long_press_handled = false;
    static absolute_time_t raw_changed_at;
    static absolute_time_t press_started_at;

    const absolute_time_t now = get_absolute_time();
    const bool raw_pressed = gpio_get(APP_BUTTON_GPIO) == 0;
    if (raw_pressed != last_raw_pressed) {
        last_raw_pressed = raw_pressed;
        raw_changed_at = now;
    }

    if (raw_pressed != stable_pressed &&
        absolute_time_diff_us(raw_changed_at, now) >= (int64_t)APP_BUTTON_DEBOUNCE_MS * 1000) {
        stable_pressed = raw_pressed;
        if (stable_pressed) {
            press_started_at = now;
            long_press_handled = false;
        } else if (!long_press_handled) {
            app_toggle_selected_mode();
        }
    }

    if (stable_pressed && !long_press_handled &&
        absolute_time_diff_us(press_started_at, now) >= (int64_t)APP_BUTTON_LONG_PRESS_MS * 1000) {
        app_select_next_mode();
        long_press_handled = true;
    }
#endif
}

#if APP_DEBUG_LOG
static void app_print_status(void)
{
    static absolute_time_t next_status;
    const absolute_time_t now = get_absolute_time();
    if (is_nil_time(next_status)) {
        next_status = delayed_by_ms(now, APP_DEBUG_INTERVAL_MS);
        return;
    }
    if (absolute_time_diff_us(now, next_status) > 0) {
        return;
    }

    const uint32_t irq_state = save_and_disable_interrupts();
    const uint32_t ticks = s_sample_ticks;
    const uint32_t input_overruns = s_input_overruns;
    const uint32_t input_dropped = s_input_dropped_samples;
    const uint32_t output_underruns = s_output_underruns;
    const uint32_t output_overruns = s_output_overruns;
    restore_interrupts(irq_state);

    const uint32_t hops = s_diag_hops;
    const uint32_t avg_process_us = hops > 0u ? (uint32_t)(s_diag_process_total_us / hops) : 0u;
    const uint32_t avg_queue_us = hops > 0u ? (uint32_t)(s_diag_queue_total_us / hops) : 0u;
    printf(
        "diag ticks=%lu mode=%s hops=%lu produced=%lu not_produced=%lu "
        "process_us avg=%lu max=%lu budget=%lu misses=%lu "
        "queue_us avg=%lu max=%lu status_errors=%lu last_status=%d last_produced=%d "
        "input_overruns=%lu input_dropped=%lu output_underruns=%lu output_overruns=%lu\n",
        (unsigned long)ticks,
        app_mode_name(s_mode),
        (unsigned long)hops,
        (unsigned long)s_diag_produced_hops,
        (unsigned long)s_diag_not_produced_hops,
        (unsigned long)avg_process_us,
        (unsigned long)s_diag_process_max_us,
        (unsigned long)APP_HOP_BUDGET_US,
        (unsigned long)s_diag_budget_misses,
        (unsigned long)avg_queue_us,
        (unsigned long)s_diag_queue_max_us,
        (unsigned long)s_diag_status_errors,
        s_diag_last_status,
        s_diag_last_produced ? 1 : 0,
        (unsigned long)input_overruns,
        (unsigned long)input_dropped,
        (unsigned long)output_underruns,
        (unsigned long)output_overruns
    );
    app_reset_diag_interval();
    next_status = delayed_by_ms(next_status, APP_DEBUG_INTERVAL_MS);
}
#endif

int main(void)
{
    stdio_init_all();
    sleep_ms(1000);

    const int cw_validation = denoise_model_validate(&k_denoise_model);
    const int voice_validation = denoise_model_validate(&k_voice_reduction_model);
#if APP_DEBUG_LOG
    printf(
        "HamNoise RP2350 ADC/PWM runtime: cw_model_validation=%d voice_model_validation=%d\n",
        cw_validation,
        voice_validation
    );
#endif
    if (cw_validation != 0 || voice_validation != 0) {
        while (true) {
            sleep_ms(1000);
        }
    }

    const int stream_status = denoise_stream_init(&s_stream);
    if (stream_status != 0) {
#if APP_DEBUG_LOG
        printf("denoise_stream_init failed: %d\n", stream_status);
#endif
        while (true) {
            sleep_ms(1000);
        }
    }

    app_adc_init();
    app_pwm_init();
    app_gpio_init();
    app_prefill_output_queue();

    alarm_id_t alarm = add_alarm_in_us(APP_SAMPLE_PERIOD_US, app_audio_tick, NULL, true);
    if (alarm < 0) {
#if APP_DEBUG_LOG
        printf("failed to start audio timer: %ld\n", (long)alarm);
#endif
        while (true) {
            sleep_ms(1000);
        }
    }

#if APP_DEBUG_LOG
    printf(
        "audio started: adc_gpio=%d adc_input=%d pwm_gpio=%d sample_rate=%d hop=%d pwm_wrap=%u\n",
        APP_ADC_GPIO,
        APP_ADC_INPUT,
        APP_PWM_GPIO,
        DENOISE_SAMPLE_RATE,
        DENOISE_HOP_LENGTH,
        APP_PWM_WRAP
    );
#endif

    float input_hop[DENOISE_HOP_LENGTH];
    float output_hop[DENOISE_HOP_LENGTH];
    while (true) {
        app_wait_and_pop_input(input_hop);
        app_update_mode_button();
        app_update_led();

        bool produced = false;
        int status = 0;
#if APP_DEBUG_LOG
        const absolute_time_t process_start = get_absolute_time();
#endif
        const denoise_model_t *model = app_mode_model(s_mode);
        if (model != NULL) {
            status = denoise_stream_process_hop(&s_stream, model, input_hop, output_hop, &produced);
        } else {
            memcpy(output_hop, input_hop, sizeof(output_hop));
            produced = true;
        }
#if APP_DEBUG_LOG
        const absolute_time_t process_end = get_absolute_time();
#endif

        if (status != 0 || !produced) {
            memset(output_hop, 0, sizeof(output_hop));
        }
#if APP_DEBUG_LOG
        const absolute_time_t queue_start = get_absolute_time();
#endif
        app_queue_output(output_hop);
#if APP_DEBUG_LOG
        const absolute_time_t queue_end = get_absolute_time();
        app_record_hop(
            (uint32_t)absolute_time_diff_us(process_start, process_end),
            (uint32_t)absolute_time_diff_us(queue_start, queue_end),
            status,
            produced
        );
        app_print_status();
#endif
    }
}
