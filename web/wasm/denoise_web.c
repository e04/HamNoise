#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#include "denoise_audio.h"
#include "cw_model_weights.h"
#include "voice_model_weights.h"

enum {
    DENOISE_WEB_MODEL_CW = 0,
    DENOISE_WEB_MODEL_VOICE_REDUCTION = 1,
};

static denoise_stream_t g_stream;
static float g_input_hop[DENOISE_HOP_LENGTH];
static float g_output_hop[DENOISE_HOP_LENGTH];
static float g_last_gains[DENOISE_INPUT_BINS];
static int g_initialized;
static int g_model_id = DENOISE_WEB_MODEL_CW;

static const denoise_model_t *denoise_web_current_model(void)
{
    if (g_model_id == DENOISE_WEB_MODEL_VOICE_REDUCTION) {
        return &k_voice_reduction_model;
    }
    return &k_denoise_model;
}

int denoise_web_init(void)
{
    const int status = denoise_stream_init(&g_stream);
    if (status != 0) {
        g_initialized = 0;
        return status;
    }
    g_initialized = 1;
    memset(g_input_hop, 0, sizeof(g_input_hop));
    memset(g_output_hop, 0, sizeof(g_output_hop));
    memset(g_last_gains, 0, sizeof(g_last_gains));
    const int cw_status = denoise_model_validate(&k_denoise_model);
    if (cw_status != 0) {
        return cw_status;
    }
    return denoise_model_validate(&k_voice_reduction_model);
}

void denoise_web_reset(void)
{
    if (!g_initialized) {
        (void)denoise_web_init();
        return;
    }
    denoise_stream_reset(&g_stream);
    memset(g_input_hop, 0, sizeof(g_input_hop));
    memset(g_output_hop, 0, sizeof(g_output_hop));
    memset(g_last_gains, 0, sizeof(g_last_gains));
}

float *denoise_web_input_ptr(void)
{
    return g_input_hop;
}

float *denoise_web_output_ptr(void)
{
    return g_output_hop;
}

float *denoise_web_gains_ptr(void)
{
    return g_last_gains;
}

int denoise_web_set_model(int model_id)
{
    if (model_id != DENOISE_WEB_MODEL_CW && model_id != DENOISE_WEB_MODEL_VOICE_REDUCTION) {
        return -1;
    }
    if (g_model_id == model_id) {
        return 0;
    }
    g_model_id = model_id;
    if (g_initialized) {
        denoise_gru_reset(&g_stream.gru);
    }
    return denoise_model_validate(denoise_web_current_model());
}

int denoise_web_process_hop(int enabled)
{
    if (!g_initialized) {
        const int status = denoise_web_init();
        if (status != 0) {
            return status;
        }
    }

    if (!enabled) {
        bool produced = false;
        const int status = denoise_stream_process_hop_bandpass(&g_stream, g_input_hop, g_output_hop, &produced);
        if (status != 0) {
            return status;
        }
        memcpy(g_last_gains, g_stream.gains, sizeof(g_last_gains));
        return produced ? 1 : 0;
    }

    bool produced = false;
    const int status = denoise_stream_process_hop(
        &g_stream,
        denoise_web_current_model(),
        g_input_hop,
        g_output_hop,
        &produced
    );
    if (status != 0) {
        return status;
    }
    memcpy(g_last_gains, g_stream.gains, sizeof(g_last_gains));
    return produced ? 1 : 0;
}

int denoise_web_sample_rate(void)
{
    return DENOISE_SAMPLE_RATE;
}

int denoise_web_hop_length(void)
{
    return DENOISE_HOP_LENGTH;
}

int denoise_web_input_bins(void)
{
    return DENOISE_INPUT_BINS;
}
