cmake_minimum_required(VERSION 3.13)

if(NOT DEFINED PICO_SDK_PATH AND DEFINED ENV{PICO_SDK_PATH})
    set(PICO_SDK_PATH "$ENV{PICO_SDK_PATH}" CACHE PATH "Path to the Pico SDK")
endif()

if(NOT DEFINED PICO_SDK_PATH)
    set(PICO_SDK_PATH "${CMAKE_CURRENT_LIST_DIR}/../../pico-sdk" CACHE PATH "Path to the Pico SDK")
endif()

if(NOT EXISTS "${PICO_SDK_PATH}/external/pico_sdk_import.cmake")
    message(FATAL_ERROR "PICO_SDK_PATH must point to a Pico SDK checkout")
endif()

set(PICO_BOARD pico2 CACHE STRING "RP2350 board target")

set(APP_ADC_GPIO "" CACHE STRING "ADC GPIO, e.g. 26 on RP2350A/Pico 2")
set(APP_ADC_INPUT "" CACHE STRING "ADC input channel; derived from APP_ADC_GPIO when empty")
set(APP_PWM_GPIO "" CACHE STRING "PWM output GPIO")
set(APP_BUTTON_GPIO "" CACHE STRING "Optional active-low denoise toggle button GPIO")
set(APP_LED_GPIO "" CACHE STRING "Optional mode status LED GPIO")
set(APP_INPUT_GAIN "" CACHE STRING "Input gain applied after ADC DC blocking")
set(APP_OUTPUT_GAIN "" CACHE STRING "Output gain applied before PWM conversion")
set(APP_ADC_MIDPOINT "" CACHE STRING "ADC midpoint used for bipolar conversion")
set(APP_DC_BLOCK_ALPHA "" CACHE STRING "One-pole DC blocker feedback coefficient")
set(APP_PWM_WRAP "" CACHE STRING "PWM TOP value")
set(APP_DEBUG_LOG "" CACHE STRING "Enable USB serial diagnostic logging, 0 or 1")
set(APP_DEBUG_INTERVAL_MS "" CACHE STRING "Diagnostic logging interval in milliseconds")
set(APP_LED_PWM_WRAP "" CACHE STRING "LED PWM TOP value")
set(APP_LED_CW_BLINK_MS "" CACHE STRING "CW mode LED blink state interval in milliseconds")
set(APP_LED_VOICE_SINE_PERIOD_MS "" CACHE STRING "Voice mode LED sine fade period in milliseconds")

include("${PICO_SDK_PATH}/external/pico_sdk_import.cmake")

project(hamnoise_rp2350 C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

pico_sdk_init()

set(DENOISE_CORE_DIR "${CMAKE_CURRENT_LIST_DIR}/../core")

add_executable(hamnoise_rp2350
    main.c
    "${DENOISE_CORE_DIR}/src/denoise_audio.c"
    "${DENOISE_CORE_DIR}/src/denoise_gru.c"
)

target_include_directories(hamnoise_rp2350 PRIVATE
    "${DENOISE_CORE_DIR}/include"
    "${DENOISE_CORE_DIR}/generated"
)

target_compile_definitions(hamnoise_rp2350 PRIVATE
    DENOISE_USE_ESP_DSP=0
    PICO_STACK_SIZE=0x1000
)

target_compile_options(hamnoise_rp2350 PRIVATE
    -O3
    -ffast-math
    -fno-math-errno
)

foreach(app_define
    APP_ADC_GPIO
    APP_ADC_INPUT
    APP_PWM_GPIO
    APP_BUTTON_GPIO
    APP_LED_GPIO
    APP_INPUT_GAIN
    APP_OUTPUT_GAIN
    APP_ADC_MIDPOINT
    APP_DC_BLOCK_ALPHA
    APP_PWM_WRAP
    APP_DEBUG_LOG
    APP_DEBUG_INTERVAL_MS
    APP_LED_PWM_WRAP
    APP_LED_CW_BLINK_MS
    APP_LED_VOICE_SINE_PERIOD_MS
)
    if(NOT "${${app_define}}" STREQUAL "")
        target_compile_definitions(hamnoise_rp2350 PRIVATE "${app_define}=${${app_define}}")
    endif()
endforeach()

target_link_libraries(hamnoise_rp2350 PRIVATE
    pico_stdlib
    pico_time
    hardware_adc
    hardware_pwm
    hardware_sync
    m
)

pico_enable_stdio_usb(hamnoise_rp2350 1)
pico_enable_stdio_uart(hamnoise_rp2350 0)
pico_add_extra_outputs(hamnoise_rp2350)
