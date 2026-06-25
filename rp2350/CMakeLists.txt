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
