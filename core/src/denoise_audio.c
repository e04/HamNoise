#include "denoise_audio.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

#ifndef DENOISE_PI
#define DENOISE_PI 3.14159265358979323846f
#endif

#define DENOISE_EDGE_FADE_BINS 4
#define DENOISE_OLA_EPS 1.0e-8f

static void denoise_fft_fallback(float *re, float *im, size_t n, bool inverse)
{
    size_t j = 0;
    for (size_t i = 1; i < n; ++i) {
        size_t bit = n >> 1;
        while ((j & bit) != 0) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
            const float tmp_re = re[i];
            const float tmp_im = im[i];
            re[i] = re[j];
            im[i] = im[j];
            re[j] = tmp_re;
            im[j] = tmp_im;
        }
    }

    for (size_t len = 2; len <= n; len <<= 1) {
        const float angle = (inverse ? 2.0f : -2.0f) * DENOISE_PI / (float)len;
        const float w_len_re = cosf(angle);
        const float w_len_im = sinf(angle);
        for (size_t i = 0; i < n; i += len) {
            float w_re = 1.0f;
            float w_im = 0.0f;
            for (size_t k = 0; k < (len >> 1); ++k) {
                const size_t even = i + k;
                const size_t odd = even + (len >> 1);
                const float odd_re = (re[odd] * w_re) - (im[odd] * w_im);
                const float odd_im = (re[odd] * w_im) + (im[odd] * w_re);
                const float even_re = re[even];
                const float even_im = im[even];
                re[even] = even_re + odd_re;
                im[even] = even_im + odd_im;
                re[odd] = even_re - odd_re;
                im[odd] = even_im - odd_im;

                const float next_w_re = (w_re * w_len_re) - (w_im * w_len_im);
                const float next_w_im = (w_re * w_len_im) + (w_im * w_len_re);
                w_re = next_w_re;
                w_im = next_w_im;
            }
        }
    }

    if (inverse) {
        const float scale = 1.0f / (float)n;
        for (size_t i = 0; i < n; ++i) {
            re[i] *= scale;
            im[i] *= scale;
        }
    }
}

static void denoise_fft(denoise_stream_t *stream, bool inverse)
{
    denoise_fft_fallback(stream->fft_re, stream->fft_im, DENOISE_FFT_LENGTH, inverse);
}

static float denoise_edge_fade(size_t band_index)
{
    if (DENOISE_SPECTROGRAM_START_BIN == 0U &&
        DENOISE_SPECTROGRAM_STOP_BIN_EXCLUSIVE == ((DENOISE_FFT_LENGTH / 2U) + 1U)) {
        return 1.0f;
    }
    if (band_index >= DENOISE_INPUT_BINS) {
        return 0.0f;
    }
    if (band_index < DENOISE_EDGE_FADE_BINS) {
        if (DENOISE_EDGE_FADE_BINS == 1) {
            return 0.0f;
        }
        return 0.5f - (0.5f * cosf(DENOISE_PI * (float)band_index / (float)(DENOISE_EDGE_FADE_BINS - 1)));
    }

    const size_t from_end = DENOISE_INPUT_BINS - 1 - band_index;
    if (from_end < DENOISE_EDGE_FADE_BINS) {
        if (DENOISE_EDGE_FADE_BINS == 1) {
            return 0.0f;
        }
        return 0.5f - (0.5f * cosf(DENOISE_PI * (float)from_end / (float)(DENOISE_EDGE_FADE_BINS - 1)));
    }
    return 1.0f;
}

void denoise_make_hann_window(float window[DENOISE_FFT_LENGTH])
{
    if (window == NULL) {
        return;
    }
    for (size_t i = 0; i < DENOISE_FFT_LENGTH; ++i) {
        window[i] = 0.5f - (0.5f * cosf((2.0f * DENOISE_PI * (float)i) / (float)DENOISE_FFT_LENGTH));
    }
}

size_t denoise_decimated_count_16k_to_3k2(size_t input_count)
{
    return input_count / 5U;
}

void denoise_decimate_16k_to_3k2_f32(const float *input_16k, size_t input_count, float *output_3k2)
{
    if (input_16k == NULL || output_3k2 == NULL) {
        return;
    }

    const size_t output_count = denoise_decimated_count_16k_to_3k2(input_count);
    for (size_t out = 0; out < output_count; ++out) {
        const size_t base = out * 5U;
        float acc = 0.0f;
        for (size_t i = 0; i < 5U; ++i) {
            acc += input_16k[base + i];
        }
        output_3k2[out] = acc * 0.2f;
    }
}

void denoise_analyze_frame(
    denoise_stream_t *stream,
    const float frame[DENOISE_FFT_LENGTH],
    float magnitude[DENOISE_INPUT_BINS],
    float features[DENOISE_INPUT_BINS]
)
{
    if (stream == NULL || frame == NULL || magnitude == NULL || features == NULL) {
        return;
    }

    for (size_t i = 0; i < DENOISE_FFT_LENGTH; ++i) {
        stream->fft_re[i] = frame[i] * stream->window[i];
        stream->fft_im[i] = 0.0f;
    }
    denoise_fft(stream, false);

    for (size_t i = 0; i < DENOISE_INPUT_BINS; ++i) {
        const size_t fft_bin = DENOISE_SPECTROGRAM_START_BIN + i;
        const float re = stream->fft_re[fft_bin];
        const float im = stream->fft_im[fft_bin];
        const float mag = sqrtf((re * re) + (im * im));
        stream->band_re[i] = re;
        stream->band_im[i] = im;
        magnitude[i] = mag;
        features[i] = log1pf(fmaxf(mag, 0.0f));
    }
}

void denoise_synthesize_frame(
    denoise_stream_t *stream,
    const float gains[DENOISE_INPUT_BINS],
    float frame_out[DENOISE_FFT_LENGTH]
)
{
    if (stream == NULL || gains == NULL || frame_out == NULL) {
        return;
    }

    memset(stream->fft_re, 0, sizeof(stream->fft_re));
    memset(stream->fft_im, 0, sizeof(stream->fft_im));

    for (size_t i = 0; i < DENOISE_INPUT_BINS; ++i) {
        const size_t fft_bin = DENOISE_SPECTROGRAM_START_BIN + i;
        const float gain = gains[i] * denoise_edge_fade(i);
        const float re = stream->band_re[i] * gain;
        const float im = stream->band_im[i] * gain;
        stream->fft_re[fft_bin] = re;
        stream->fft_im[fft_bin] = im;

        if (fft_bin > 0U && fft_bin < (DENOISE_FFT_LENGTH / 2U)) {
            const size_t mirror_bin = DENOISE_FFT_LENGTH - fft_bin;
            stream->fft_re[mirror_bin] = re;
            stream->fft_im[mirror_bin] = -im;
        }
    }

    denoise_fft(stream, true);
    for (size_t i = 0; i < DENOISE_FFT_LENGTH; ++i) {
        frame_out[i] = stream->fft_re[i] * stream->window[i];
    }
}

int denoise_stream_init(denoise_stream_t *stream)
{
    if (stream == NULL) {
        return -1;
    }
    memset(stream, 0, sizeof(*stream));
    denoise_make_hann_window(stream->window);
    return 0;
}

void denoise_stream_reset(denoise_stream_t *stream)
{
    if (stream == NULL) {
        return;
    }
    const float window[DENOISE_FFT_LENGTH] = {0};
    memcpy(stream->window, window, sizeof(stream->window));
    denoise_make_hann_window(stream->window);
    memset(stream->input_fifo, 0, sizeof(stream->input_fifo));
    memset(stream->fft_re, 0, sizeof(stream->fft_re));
    memset(stream->fft_im, 0, sizeof(stream->fft_im));
    memset(stream->ola, 0, sizeof(stream->ola));
    memset(stream->ola_norm, 0, sizeof(stream->ola_norm));
    denoise_gru_reset(&stream->gru);
    stream->buffered = 0;
}

static void denoise_shift_left(float *values, size_t size, size_t amount)
{
    if (amount >= size) {
        memset(values, 0, size * sizeof(values[0]));
        return;
    }
    memmove(values, values + amount, (size - amount) * sizeof(values[0]));
    memset(values + (size - amount), 0, amount * sizeof(values[0]));
}

static int denoise_stream_process_hop_internal(
    denoise_stream_t *stream,
    const denoise_model_t *model,
    const float input_hop[DENOISE_HOP_LENGTH],
    float output_hop[DENOISE_HOP_LENGTH],
    bool *produced,
    bool bandpass_only
)
{
    if (produced != NULL) {
        *produced = false;
    }
    if (stream == NULL || input_hop == NULL || output_hop == NULL || (!bandpass_only && model == NULL)) {
        return -1;
    }
    if ((stream->buffered + DENOISE_HOP_LENGTH) > (DENOISE_FFT_LENGTH + DENOISE_HOP_LENGTH)) {
        return -2;
    }

    memcpy(stream->input_fifo + stream->buffered, input_hop, DENOISE_HOP_LENGTH * sizeof(float));
    stream->buffered += DENOISE_HOP_LENGTH;

    if (stream->buffered < DENOISE_FFT_LENGTH) {
        memset(output_hop, 0, DENOISE_HOP_LENGTH * sizeof(float));
        return 0;
    }

    denoise_analyze_frame(stream, stream->input_fifo, stream->magnitude, stream->features);
    if (bandpass_only) {
        for (size_t i = 0; i < DENOISE_INPUT_BINS; ++i) {
            stream->gains[i] = 1.0f;
        }
    } else {
        const int status = denoise_gru_step(model, &stream->gru, stream->features, stream->gains);
        if (status != 0) {
            return status;
        }
    }

    float frame_out[DENOISE_FFT_LENGTH];
    denoise_synthesize_frame(stream, stream->gains, frame_out);
    for (size_t i = 0; i < DENOISE_FFT_LENGTH; ++i) {
        stream->ola[i] += frame_out[i];
        stream->ola_norm[i] += stream->window[i] * stream->window[i];
    }

    for (size_t i = 0; i < DENOISE_HOP_LENGTH; ++i) {
        output_hop[i] = (stream->ola_norm[i] > DENOISE_OLA_EPS) ? (stream->ola[i] / stream->ola_norm[i]) : 0.0f;
    }

    denoise_shift_left(stream->ola, DENOISE_FFT_LENGTH, DENOISE_HOP_LENGTH);
    denoise_shift_left(stream->ola_norm, DENOISE_FFT_LENGTH, DENOISE_HOP_LENGTH);
    memmove(
        stream->input_fifo,
        stream->input_fifo + DENOISE_HOP_LENGTH,
        (stream->buffered - DENOISE_HOP_LENGTH) * sizeof(float)
    );
    stream->buffered -= DENOISE_HOP_LENGTH;

    if (produced != NULL) {
        *produced = true;
    }
    return 0;
}

int denoise_stream_process_hop(
    denoise_stream_t *stream,
    const denoise_model_t *model,
    const float input_hop[DENOISE_HOP_LENGTH],
    float output_hop[DENOISE_HOP_LENGTH],
    bool *produced
)
{
    return denoise_stream_process_hop_internal(stream, model, input_hop, output_hop, produced, false);
}

int denoise_stream_process_hop_bandpass(
    denoise_stream_t *stream,
    const float input_hop[DENOISE_HOP_LENGTH],
    float output_hop[DENOISE_HOP_LENGTH],
    bool *produced
)
{
    if (stream == NULL || input_hop == NULL || output_hop == NULL) {
        if (produced != NULL) {
            *produced = false;
        }
        return -1;
    }

    return denoise_stream_process_hop_internal(stream, NULL, input_hop, output_hop, produced, true);
}

int denoise_process_3k2_f32(
    const denoise_model_t *model,
    const float *input,
    size_t input_count,
    float *output
)
{
    if (model == NULL || input == NULL || output == NULL) {
        return -1;
    }

    memset(output, 0, input_count * sizeof(float));

    denoise_stream_t stream;
    int status = denoise_stream_init(&stream);
    if (status != 0) {
        return status;
    }

    float hop_in[DENOISE_HOP_LENGTH] = {0};
    float hop_out[DENOISE_HOP_LENGTH] = {0};
    size_t read_pos = 0;
    size_t write_pos = 0;
    while (read_pos < input_count) {
        memset(hop_in, 0, sizeof(hop_in));
        const size_t remaining = input_count - read_pos;
        const size_t copy_count = remaining < DENOISE_HOP_LENGTH ? remaining : DENOISE_HOP_LENGTH;
        memcpy(hop_in, input + read_pos, copy_count * sizeof(float));
        read_pos += copy_count;

        bool produced = false;
        status = denoise_stream_process_hop(&stream, model, hop_in, hop_out, &produced);
        if (status != 0) {
            return status;
        }
        if (produced && write_pos < input_count) {
            const size_t writable = (input_count - write_pos) < DENOISE_HOP_LENGTH ?
                (input_count - write_pos) : DENOISE_HOP_LENGTH;
            memcpy(output + write_pos, hop_out, writable * sizeof(float));
            write_pos += writable;
        }
    }

    for (size_t flush = 0; flush < (DENOISE_FFT_LENGTH / DENOISE_HOP_LENGTH) + 2U && write_pos < input_count; ++flush) {
        memset(hop_in, 0, sizeof(hop_in));
        bool produced = false;
        status = denoise_stream_process_hop(&stream, model, hop_in, hop_out, &produced);
        if (status != 0) {
            return status;
        }
        if (produced) {
            const size_t writable = (input_count - write_pos) < DENOISE_HOP_LENGTH ?
                (input_count - write_pos) : DENOISE_HOP_LENGTH;
            memcpy(output + write_pos, hop_out, writable * sizeof(float));
            write_pos += writable;
        }
    }

    return 0;
}
