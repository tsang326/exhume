// Limits_Module: every numeric constant of the MCP server lives here.
// Other files under src/mcp may use only the literals 0, 1 and 2.

// Limits named in the requirements
export const MAX_LINE_BYTES = 1_048_576;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_ARG_CHARS = 4_096;
export const MAX_REPORT_ENTRIES = 200;
export const MAX_REPORT_WARNINGS = 50;
export const MAX_NAME_CHARS = 255;
export const MAX_REASON_CHARS_OUT = 200;
export const MAX_TEXT_CHARS = 65_536;
export const MAX_EXHUME_NAME_CHARS = 64;
export const MAX_SUFFIX = 99;

// Protocol versions
export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const DEFAULT_VERSION = '2025-06-18';

// I/O loop caps
export const MAX_READ_CALLS = 64; // read loop cap for one image
export const MAX_WRITE_CALLS = 4_096; // write loop cap for one exhumed file

// Byte values
export const BYTE_LF = 0x0a;
export const BYTE_CR = 0x0d;

// File modes
export const FILE_MODE = 0o644;
export const DIR_MODE = 0o755;

// JSON-RPC error codes
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

// PNG header offsets (IHDR width and height, big-endian uint32)
export const PNG_WIDTH_OFFSET = 16;
export const PNG_HEIGHT_OFFSET = 20;
export const PNG_MIN_BYTES = 24;

// Sanitizer code points (UTF-16 code unit values)
export const REPLACEMENT = 0xfffd;
export const CP_TAB = 0x09;
export const CP_LF = 0x0a;
export const CP_CR = 0x0d;
export const CP_SPACE = 0x20;
export const CP_C0_MAX = 0x1f;
export const CP_DEL = 0x7f;
export const CP_C1_MIN = 0x80;
export const CP_C1_MAX = 0x9f;
export const CP_LINE_SEPARATOR = 0x2028;
export const CP_PARAGRAPH_SEPARATOR = 0x2029;
export const CP_BIDI_EMBED_MIN = 0x202a;
export const CP_BIDI_EMBED_MAX = 0x202e;
export const CP_BIDI_ISOLATE_MIN = 0x2066;
export const CP_BIDI_ISOLATE_MAX = 0x2069;
export const CP_BOM = 0xfeff;
export const CP_HIGH_SURROGATE_MIN = 0xd800;
export const CP_HIGH_SURROGATE_MAX = 0xdbff;
export const CP_LOW_SURROGATE_MIN = 0xdc00;
export const CP_LOW_SURROGATE_MAX = 0xdfff;

/** Upper bound on the number of path segments of the Home_Directory realpath that the identity test walks. */
export const MAX_HOME_SEGMENTS = 64;
