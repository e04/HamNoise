#ifndef DENOISE_GRU_H
#define DENOISE_GRU_H

#include "denoise_model.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    float hidden[DENOISE_HIDDEN_SIZE];

    float input_norm[DENOISE_INPUT_BINS];
    float gates_ih[DENOISE_GRU_GATES * DENOISE_HIDDEN_SIZE];
    float gates_hh[DENOISE_GRU_GATES * DENOISE_HIDDEN_SIZE];
    float next_hidden[DENOISE_HIDDEN_SIZE];
    float output_norm[DENOISE_HIDDEN_SIZE];
    float fc1[DENOISE_HIDDEN_SIZE];
    float logits[DENOISE_INPUT_BINS];
} denoise_gru_state_t;

void denoise_gru_reset(denoise_gru_state_t *state);
int denoise_gru_step(
    const denoise_model_t *model,
    denoise_gru_state_t *state,
    const float features[DENOISE_INPUT_BINS],
    float gains[DENOISE_INPUT_BINS]
);

#ifdef __cplusplus
}
#endif

#endif
