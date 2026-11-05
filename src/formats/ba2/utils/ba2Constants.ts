/**
 * BA2 GNRL format constants used by reader/writer modules.
 */
export const BA2_MAGIC = 'BTDX';
export const BA2_TYPE_GNRL = 'GNRL';
export const BA2_VERSION = 1;
export const BA2_HEADER_SIZE = 24;
export const BA2_ENTRY_SIZE = 36;
/** What Archive2 writes into every GNRL entry's flags field. */
export const BA2_ENTRY_FLAGS = 0x100100;
/** What Archive2 writes into every GNRL entry's align field. */
export const BA2_ENTRY_ALIGN = 0xbaadf00d;
