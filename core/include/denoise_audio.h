#ifndef DENOISE_AUDIO_H
#define DENOISE_AUDIO_H

#include <stdbool.h>
#include <stddef.h>

#include "denoise_gru.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    float window[DENOISE_FFT_LENGTH];
    float window_sq[DENOISE_FFT_LENGTH];
    float edge_fade[DENOISE_INPUT_BINS];
    float input_fifo[DENOISE_FFT_LENGTH + DENOISE_HOP_LENGTH];
    float fft_re[DENOISE_FFT_LENGTH];
    float fft_im[DENOISE_FFT_LENGTH];
    float ola[DENOISE_FFT_LENGTH];
    float ola_norm[DENOISE_FFT_LENGTH];
    float frame_out[DENOISE_FFT_LENGTH];
    float features[DENOISE_INPUT_BINS];
    float magnitude[DENOISE_INPUT_BINS];
    float band_re[DENOISE_INPUT_BINS];
    float band_im[DENOISE_INPUT_BINS];
    float gains[DENOISE_INPUT_BINS];
    denoise_gru_state_t gru;
    size_t buffered;
} denoise_stream_t;

void denoise_make_hann_window(float window[DENOISE_FFT_LENGTH]);
void denoise_decimate_16k_to_3k2_f32(const float *input_16k, size_t input_count, float *output_3k2);
size_t denoise_decimated_count_16k_to_3k2(size_t input_count);

void denoise_analyze_frame(
    denoise_stream_t *stream,
    const float frame[DENOISE_FFT_LENGTH],
    float magnitude[DENOISE_INPUT_BINS],
    float features[DENOISE_INPUT_BINS]
);

void denoise_synthesize_frame(
    denoise_stream_t *stream,
    const float gains[DENOISE_INPUT_BINS],
    float frame_out[DENOISE_FFT_LENGTH]
);

int denoise_stream_init(denoise_stream_t *stream);
void denoise_stream_reset(denoise_stream_t *stream);
int denoise_stream_process_hop(
    denoise_stream_t *stream,
    const denoise_model_t *model,
    const float input_hop[DENOISE_HOP_LENGTH],
    float output_hop[DENOISE_HOP_LENGTH],
    bool *produced
);

int denoise_stream_process_hop_bandpass(
    denoise_stream_t *stream,
    const float input_hop[DENOISE_HOP_LENGTH],
    float output_hop[DENOISE_HOP_LENGTH],
    bool *produced
);

int denoise_process_3k2_f32(
    const denoise_model_t *model,
    const float *input,
    size_t input_count,
    float *output
);

#ifdef __cplusplus
}
#endif

#endif
