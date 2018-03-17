exports.versions = [
    // model, version, firmware version, firmware name, decompression metadata
    ['C59Y1', 'M1INT', 'Ver1.12', '1.0.20-int', null],
    ['C59Y1', 'M1INT', 'Ver1.29', '2.0-int', null],
    ['C59Y1', 'M1INT', 'Ver1.35tg', '2.5.5-int (3.0 public beta)', null],
    ['C59Y1', 'M1INT', 'Ver1.35ts', '2.8.17-int (3.0 private beta)', null],
    ['C59Y1', 'M1INT', 'Ver1.37', '2.9.1-int (3.0 private beta)', null],
    ['C59Y1', 'M1INT', 'Ver1.38', '2.9.5-int (3.0 private beta)', null],
    ['C59Y1', 'M1INT', 'Ver1.39', '3.0-int', [
        // start, end, compressed, lookup buffer offset (if compressed)
        [0, 0x2000, false, -1],
        // All compressed sections have a -18 buffer offset, seems like there is an 18 byte header
        // Actually, all sections start with compressed data, there seems not to be a 18 byte header... where do the
        // 18 byte come from? Init data? Where does the init data come from?
        // TODO why the 18 byte offset?
        // TODO where are the sections and their lengths described?
        // All sections have trailing zero-bytes to fit a multiple of 2048 bytes
        // These are the numbers for FW 3.0-int (2.0-int: 8192, 3158016, 6625280)
        [0x2000, 3127296, true, -18],
        [3127296, 7251968, true, -18],
        [7251968, -1, true, -18],
    ]],
    ['C59Y1', 'M1INT', 'Ver1.41', '3.1-int', null],
];
