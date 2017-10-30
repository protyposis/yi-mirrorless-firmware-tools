YI M1 Mirrorless Camera Firmware Unpacker
=========================================

A firmware unpacker for YI M1 firmware files. Currently does not much more than parsing the section headers of a firmware file and extracting the sections into separate files. Works with all firmware versions.

Requirements: Node.js & npm
 
Usage: 
 1. `npm install`
 1. `npm run unpack /path/to/firmware.bin`
 1. `npm run decompress /path/to/firmware.bin.0` (output from `unpack`)

The output will be a number of files (usually 4) named `firmware.bin.{sectionNumber}.{sectionId}`.

Firmware analysis
-----------------

Firmware files consist of 4 sections.

| Section Number | Section Id | Size | Description |
| -------------- | ---------- | ---- | ----------- |
| 0              | *none*     | variable, ~7 MB | Most probably the actual firmware code. Contains two sections with 0x1000 byte length each, followed by compressed data (compressed with some kind of LZSS algorithm). |
| 1              | ND1        | variable, ~4 MB | Offset 0x1600000. Memory image that contains resources like bitmaps, fonts, and texts in different languages |
| 2              | IPL        | 128 kB, 0x20000 byte | Bootloader (Initial Program Loader) |
| 3              | PTBL       | 4 kB, 0x1000 byte | Partition table, unknown format |

### Section headers

The section headers inside the firmware file are simple strings with a length of 256 byte (0x100). Examples from FW 2.9.1-int:

```
LENGTH=7366656 C59Y1 VER=M1INT DVR=Ver1.37 SUM=937214718 ND1 IPL PTBL
ND1 LENGTH=4197888 C59Y1 VER=M1INT DVR=Ver1.37 SUM=299791776 OFFSET=23068672
IPL LENGTH=131072 C59Y1 VER=M1INT DVR=Ver1.37 SUM=5714438
PTBL LENGTH=4096  C59Y1 VER=M1INT SUM=5181
```

The `LENGTH` is the length in bytes of the following section body. `SUM` is a simple checksum calculated by summing all bytes. `OFFSET` seems to be an offset in the camera's memory space to which the section is written. The first header has the IDs of the following headers appended. All following headers start with their ID.

A similar header format can be found in the firmware of an unknown device C5932 / C5932-v84. A similar format, but with shorter length, can also be found on some Fujifilm cameras (e.g. Finepix S800).

### Hardware & Software Identification

Some interesting strings:

Section 0 / System

 * minios/iap_app
 * C:/XC_ODM/sdk/SDK_selfcheck/src/EV9x_DevEnv
 * minios/me_app
 * BCM4343A1_00_1.002 -> Wifi radio?
 * WA1 37.4MHz Murata Type-1FJ BT4.1 OTP-BD -> Bluetooth radio?
 * auth-keepalive-txbf-pktfilter-mchan-proptxstatus Version: 7.10.48.2 CRC: 396141be Date: Thu 2016-05-19 16:51:41 KST Ucode: 997.0 FWID.: 01-b37064e2
 * C%s: only support 1-stream 11n_256QAM for non-11ac compiled device!
 * Copyright (c) 2009-2010 Tokyo Electron Device Ltd
 * Broadcom BCM.%s 802.11 Wireless Controller %s
 * BCM43
 * Broadcom-0
 * 43430a1-roml/sdio-g-pool-apcs-i
 * auth Version: 7.10.48.2 CRC: 6164d53b Date: Tue 2016-04-05 10:19:38 KST Ucode
 * caddr=00:90:4c:c5:12 -> Epigram MAC (Broadcom)
 * xtalfreq=374
 * bcm9
 * Copyright 2009 Murata Manufacturing Co.,Ltd

Section 2 / IPL

 * PureNAND IPL ev9x-v1.8t.r1864 (Mimasaka) [DEBUG BUILD] (Feb 10 2016 10:30:54)
 * EV9XES1.0
 * EV9XES2.0
 * Warning: EV9X ES1.0 does not use 513MHz, it was changed to 400MHz
 * ARM926_1
 * ARM926_2
 * BCH2K124

### Next steps

 * Identify the exact format of the first section / fix decompression
 * Identify partition table format and decode
 * Disassemble first section
 * Change something simple (e.g. the 500 shot limit in the beta firmware), repack FW file and upload to camera

FAQ
---

> What's the purpose of this tool?

To lay the roots for a firmware hack.

> What can a potential firmware hack do?

 * Increase video bitrates
 * Add 24p video modes
 * Decrease JPEG compression
 * Change focus peaking color
 * Fix UX issues
   * Disable full shutter button press during video recording which stops the recording while a half press triggers focus
   
> How can I contribute?

Please open an issue, pull request, or drop me a mail at mg@protyposis.net

> How dare you write this in JavaScript?

Times are changing, and messing with the string headers in C seemed too much of a hassle. JS with Node also runs on virtually every platform.