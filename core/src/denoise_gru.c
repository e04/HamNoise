#include "denoise_gru.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

#ifndef DENOISE_RESTRICT
#if defined(__STDC_VERSION__) && (__STDC_VERSION__ >= 199901L)
#define DENOISE_RESTRICT restrict
#else
#define DENOISE_RESTRICT
#endif
#endif

enum {
    DENOISE_GATE_RESET = 0,
    DENOISE_GATE_UPDATE = 1,
    DENOISE_GATE_NEW = 2,
};

#if defined(DENOISE_FAST_ACTIVATION) && DENOISE_FAST_ACTIVATION
static float denoise_fast_tanh(float x)
{
    if (x <= -3.0f) {
        return -1.0f;
    }
    if (x >= 3.0f) {
        return 1.0f;
    }
    const float x2 = x * x;
    return (x * (27.0f + x2)) / (27.0f + (9.0f * x2));
}

static float denoise_sigmoid(float x)
{
    return 0.5f + (0.5f * denoise_fast_tanh(0.5f * x));
}

static float denoise_tanh(float x)
{
    return denoise_fast_tanh(x);
}
#else
static float denoise_sigmoid(float x)
{
    if (x >= 0.0f) {
        const float z = expf(-x);
        return 1.0f / (1.0f + z);
    }
    const float z = expf(x);
    return z / (1.0f + z);
}

static float denoise_tanh(float x)
{
    return tanhf(x);
}
#endif

static float denoise_silu(float x)
{
    return x * denoise_sigmoid(x);
}

static void denoise_layer_norm(
    const float *DENOISE_RESTRICT input,
    const float *DENOISE_RESTRICT weight,
    const float *DENOISE_RESTRICT bias,
    size_t size,
    float eps,
    float *DENOISE_RESTRICT output
)
{
    float mean = 0.0f;
    for (size_t i = 0; i < size; ++i) {
        mean += input[i];
    }
    mean /= (float)size;

    float variance = 0.0f;
    for (size_t i = 0; i < size; ++i) {
        const float centered = input[i] - mean;
        variance += centered * centered;
    }
    variance /= (float)size;

    const float scale = 1.0f / sqrtf(variance + eps);
    for (size_t i = 0; i < size; ++i) {
        output[i] = ((input[i] - mean) * scale) * weight[i] + bias[i];
    }
}

static void denoise_linear(
    const float *DENOISE_RESTRICT weight,
    const float *DENOISE_RESTRICT bias,
    const float *DENOISE_RESTRICT input,
    size_t output_size,
    size_t input_size,
    float *DENOISE_RESTRICT output
)
{
    for (size_t out = 0; out < output_size; ++out) {
        const float *row = weight + (out * input_size);
        float acc = bias[out];
        size_t in = 0;
        for (; (in + 3U) < input_size; in += 4U) {
            acc += row[in] * input[in];
            acc += row[in + 1U] * input[in + 1U];
            acc += row[in + 2U] * input[in + 2U];
            acc += row[in + 3U] * input[in + 3U];
        }
        for (; in < input_size; ++in) {
            acc += row[in] * input[in];
        }
        output[out] = acc;
    }
}

int denoise_model_validate(const denoise_model_t *model)
{
    if (model == NULL) {
        return -1;
    }
    if (model->input_bins != DENOISE_INPUT_BINS || model->hidden_size != DENOISE_HIDDEN_SIZE) {
        return -2;
    }
    if (model->input_norm_weight == NULL || model->input_norm_bias == NULL ||
        model->gru_weight_ih == NULL || model->gru_weight_hh == NULL ||
        model->gru_bias_ih == NULL || model->gru_bias_hh == NULL ||
        model->output_norm_weight == NULL || model->output_norm_bias == NULL ||
        model->fc1_weight == NULL || model->fc1_bias == NULL ||
        model->fc2_weight == NULL || model->fc2_bias == NULL) {
        return -3;
    }
    if (model->max_gain <= 0.0f || model->layer_norm_eps <= 0.0f) {
        return -4;
    }
    return 0;
}

void denoise_gru_reset(denoise_gru_state_t *state)
{
    if (state != NULL) {
        memset(state, 0, sizeof(*state));
    }
}

int denoise_gru_step(
    const denoise_model_t *model,
    denoise_gru_state_t *state,
    const float features[DENOISE_INPUT_BINS],
    float gains[DENOISE_INPUT_BINS]
)
{
#if !defined(DENOISE_SKIP_RUNTIME_MODEL_VALIDATE) || !DENOISE_SKIP_RUNTIME_MODEL_VALIDATE
    const int validation = denoise_model_validate(model);
    if (validation != 0) {
        return validation;
    }
#endif
    if (state == NULL || features == NULL || gains == NULL) {
        return -5;
    }

    denoise_layer_norm(
        features,
        model->input_norm_weight,
        model->input_norm_bias,
        DENOISE_INPUT_BINS,
        model->layer_norm_eps,
        state->input_norm
    );

    denoise_linear(
        model->gru_weight_ih,
        model->gru_bias_ih,
        state->input_norm,
        DENOISE_GRU_GATES * DENOISE_HIDDEN_SIZE,
        DENOISE_INPUT_BINS,
        state->gates_ih
    );
    denoise_linear(
        model->gru_weight_hh,
        model->gru_bias_hh,
        state->hidden,
        DENOISE_GRU_GATES * DENOISE_HIDDEN_SIZE,
        DENOISE_HIDDEN_SIZE,
        state->gates_hh
    );

    for (size_t i = 0; i < DENOISE_HIDDEN_SIZE; ++i) {
        const size_t reset_index = (DENOISE_GATE_RESET * DENOISE_HIDDEN_SIZE) + i;
        const size_t update_index = (DENOISE_GATE_UPDATE * DENOISE_HIDDEN_SIZE) + i;
        const size_t new_index = (DENOISE_GATE_NEW * DENOISE_HIDDEN_SIZE) + i;

        const float reset_gate = denoise_sigmoid(state->gates_ih[reset_index] + state->gates_hh[reset_index]);
        const float update_gate = denoise_sigmoid(state->gates_ih[update_index] + state->gates_hh[update_index]);
        const float new_gate = denoise_tanh(state->gates_ih[new_index] + (reset_gate * state->gates_hh[new_index]));
        state->next_hidden[i] = ((1.0f - update_gate) * new_gate) + (update_gate * state->hidden[i]);
    }
    memcpy(state->hidden, state->next_hidden, sizeof(state->hidden));

    denoise_layer_norm(
        state->hidden,
        model->output_norm_weight,
        model->output_norm_bias,
        DENOISE_HIDDEN_SIZE,
        model->layer_norm_eps,
        state->output_norm
    );
    denoise_linear(
        model->fc1_weight,
        model->fc1_bias,
        state->output_norm,
        DENOISE_HIDDEN_SIZE,
        DENOISE_HIDDEN_SIZE,
        state->fc1
    );
    for (size_t i = 0; i < DENOISE_HIDDEN_SIZE; ++i) {
        state->fc1[i] = denoise_silu(state->fc1[i]);
    }
    denoise_linear(
        model->fc2_weight,
        model->fc2_bias,
        state->fc1,
        DENOISE_INPUT_BINS,
        DENOISE_HIDDEN_SIZE,
        state->logits
    );

    for (size_t i = 0; i < DENOISE_INPUT_BINS; ++i) {
        gains[i] = denoise_sigmoid(state->logits[i]) * model->max_gain;
    }

    return 0;
}
