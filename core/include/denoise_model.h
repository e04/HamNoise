#ifndef DENOISE_MODEL_H
#define DENOISE_MODEL_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DENOISE_SAMPLE_RATE 9600
#define DENOISE_FFT_LENGTH 256
#define DENOISE_HOP_LENGTH 144
#define DENOISE_SPECTROGRAM_START_BIN 0
#define DENOISE_SPECTROGRAM_STOP_BIN_EXCLUSIVE 129
#define DENOISE_INPUT_BINS 129
#define DENOISE_HIDDEN_SIZE 128
#define DENOISE_GRU_GATES 3
#define DENOISE_LAYER_NORM_EPS 1.0e-5f

#if DENOISE_SPECTROGRAM_STOP_BIN_EXCLUSIVE > ((DENOISE_FFT_LENGTH / 2) + 1)
#error "DENOISE_SPECTROGRAM_STOP_BIN_EXCLUSIVE exceeds the real FFT bin range"
#endif

#if DENOISE_INPUT_BINS != (DENOISE_SPECTROGRAM_STOP_BIN_EXCLUSIVE - DENOISE_SPECTROGRAM_START_BIN)
#error "DENOISE_INPUT_BINS must match the configured spectrogram band"
#endif

typedef struct {
    uint32_t input_bins;
    uint32_t hidden_size;
    float max_gain;
    float layer_norm_eps;

    const float *input_norm_weight;   /* [input_bins] */
    const float *input_norm_bias;     /* [input_bins] */

    const float *gru_weight_ih;       /* [3 * hidden_size, input_bins], PyTorch gate order: reset, update, new */
    const float *gru_weight_hh;       /* [3 * 64, 64], PyTorch gate order: reset, update, new */
    const float *gru_bias_ih;         /* [3 * 64] */
    const float *gru_bias_hh;         /* [3 * 64] */

    const float *output_norm_weight;  /* [64] */
    const float *output_norm_bias;    /* [64] */
    const float *fc1_weight;          /* [64, 64] */
    const float *fc1_bias;            /* [64] */
    const float *fc2_weight;          /* [input_bins, hidden_size] */
    const float *fc2_bias;            /* [input_bins] */
} denoise_model_t;

int denoise_model_validate(const denoise_model_t *model);

#ifdef __cplusplus
}
#endif

#endif
