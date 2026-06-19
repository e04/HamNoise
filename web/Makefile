EMCC ?= emcc

WASM_DIR := wasm
CORE_DIR := ../core
OUT := denoise.wasm

CFLAGS := -O3 -std=c11 \
	-I$(CORE_DIR)/include \
	-I$(CORE_DIR)/generated

EXPORTS := \
	-Wl,--export=denoise_web_init \
	-Wl,--export=denoise_web_reset \
	-Wl,--export=denoise_web_input_ptr \
	-Wl,--export=denoise_web_output_ptr \
	-Wl,--export=denoise_web_gains_ptr \
	-Wl,--export=denoise_web_set_model \
	-Wl,--export=denoise_web_process_hop \
	-Wl,--export=denoise_web_sample_rate \
	-Wl,--export=denoise_web_hop_length \
	-Wl,--export=denoise_web_input_bins

SRCS := \
	$(WASM_DIR)/denoise_web.c \
	$(CORE_DIR)/src/denoise_audio.c \
	$(CORE_DIR)/src/denoise_gru.c

.PHONY: all clean

all: $(OUT)

$(OUT): $(SRCS) $(CORE_DIR)/include/denoise_audio.h $(CORE_DIR)/generated/cw_model_weights.h $(CORE_DIR)/generated/voice_model_weights.h Makefile
	$(EMCC) $(CFLAGS) $(SRCS) --no-entry $(EXPORTS) -s STANDALONE_WASM=1 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -o $@

clean:
	rm -f $(OUT)
