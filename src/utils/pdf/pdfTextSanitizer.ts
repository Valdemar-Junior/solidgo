/**
 * PDF Text Sanitizer Utility
 * 
 * This utility provides text sanitization for PDF generation using pdf-lib.
 * Standard PDF fonts (Helvetica, Times, Courier) only support WinAnsi (Latin-1) encoding.
 * Characters outside this encoding will cause "Window closed" errors.
 * 
 * ALL PDF generators should use these functions to ensure text is safe for rendering.
 */

/**
 * Sanitize text to remove/replace characters not supported by standard PDF fonts.
 * This function replaces common Unicode characters with ASCII equivalents and
 * removes any remaining unsupported characters.
 */
export function sanitizePdfText(text: string | null | undefined): string {
    if (!text) return '';
    let result = String(text);

    // Replace common special characters with ASCII equivalents
    const replacements: [string, string][] = [
        // Dashes and hyphens
        ['\u2013', '-'],   // en dash
        ['\u2014', '-'],   // em dash
        ['\u2015', '-'],   // horizontal bar
        ['\u2212', '-'],   // minus sign

        // Quotes
        ['\u2018', "'"],   // left single quote
        ['\u2019', "'"],   // right single quote
        ['\u201A', "'"],   // single low quote
        ['\u201B', "'"],   // single high-reversed quote
        ['\u2032', "'"],   // prime
        ['\u201C', '"'],   // left double quote
        ['\u201D', '"'],   // right double quote
        ['\u201E', '"'],   // double low quote
        ['\u201F', '"'],   // double high-reversed quote
        ['\u2033', '"'],   // double prime
        ['\u00AB', '"'],   // left guillemet
        ['\u00BB', '"'],   // right guillemet

        // Other punctuation
        ['\u2026', '...'], // ellipsis
        ['\u2022', '-'],   // bullet
        ['\u2023', '>'],   // triangular bullet
        ['\u2043', '-'],   // hyphen bullet
        ['\u25CF', '*'],   // black circle
        ['\u25CB', 'o'],   // white circle
        ['\u25A0', '#'],   // black square
        ['\u25A1', '#'],   // white square

        // Symbols
        ['\u00B0', 'o'],   // degree
        ['\u2122', 'TM'],  // trademark
        ['\u00AE', '(R)'], // registered
        ['\u00A9', '(C)'], // copyright
        ['\u00D7', 'x'],   // multiplication
        ['\u00F7', '/'],   // division
        ['\u2264', '<='],  // less than or equal
        ['\u2265', '>='],  // greater than or equal
        ['\u2260', '!='],  // not equal
        ['\u221E', 'inf'], // infinity
        ['\u2248', '~'],   // approximately equal
        ['\u2713', 'v'],   // check mark
        ['\u2714', 'v'],   // heavy check mark
        ['\u2717', 'x'],   // ballot x
        ['\u2718', 'x'],   // heavy ballot x
        ['\u2190', '<-'],  // left arrow
        ['\u2192', '->'],  // right arrow
        ['\u2191', '^'],   // up arrow
        ['\u2193', 'v'],   // down arrow

        // Currency
        ['\u20AC', 'EUR'], // euro
        ['\u00A3', 'GBP'], // pound
        ['\u00A5', 'JPY'], // yen
        ['\u20B9', 'INR'], // rupee

        // Spaces and invisible characters
        ['\u00A0', ' '],   // non-breaking space
        ['\u2003', ' '],   // em space
        ['\u2002', ' '],   // en space
        ['\u2000', ' '],   // en quad
        ['\u2001', ' '],   // em quad
        ['\u2004', ' '],   // three-per-em space
        ['\u2005', ' '],   // four-per-em space
        ['\u2006', ' '],   // six-per-em space
        ['\u2007', ' '],   // figure space
        ['\u2008', ' '],   // punctuation space
        ['\u2009', ' '],   // thin space
        ['\u200A', ' '],   // hair space
        ['\u202F', ' '],   // narrow no-break space
        ['\u205F', ' '],   // medium mathematical space
        ['\u3000', ' '],   // ideographic space
        ['\u200B', ''],    // zero-width space
        ['\u200C', ''],    // zero-width non-joiner
        ['\u200D', ''],    // zero-width joiner
        ['\uFEFF', ''],    // BOM / zero-width no-break space

        // Line breaks and formatting
        ['\u2028', '\n'],  // line separator
        ['\u2029', '\n'],  // paragraph separator
        ['\r\n', '\n'],    // Windows line ending
        ['\r', '\n'],      // old Mac line ending

        // Common emoji replacements
        ['\u2764', '<3'],  // heart
        ['\u263A', ':)'],  // smiley face
        ['\u2639', ':('],  // sad face
    ];

    for (const [char, replacement] of replacements) {
        result = result.split(char).join(replacement);
    }

    // Remove any remaining non-Latin1 characters
    // WinAnsi encoding supports:
    // - ASCII printable characters (0x20-0x7E)
    // - Extended Latin-1 characters (0xA0-0xFF)
    // This regex removes everything else
    result = result.replace(/[^\x20-\x7E\xA0-\xFF\n\t]/g, '');

    // Clean up multiple spaces and trim
    result = result.replace(/  +/g, ' ');

    return result;
}

/**
 * Wrap text to fit within a maximum width, with sanitization.
 * Safe version that will never throw on font measurement errors.
 */
export function wrapTextSafe(
    text: string | null | undefined,
    maxWidth: number,
    font: { widthOfTextAtSize: (text: string, size: number) => number },
    size: number
): string[] {
    const sanitized = sanitizePdfText(text);
    if (!sanitized) return [''];

    const words = sanitized.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [''];

    const lines: string[] = [];
    let current = '';

    for (const w of words) {
        const test = current ? current + ' ' + w : w;
        try {
            const width = font.widthOfTextAtSize(test, size);
            if (width > maxWidth && current) {
                lines.push(current);
                current = w;
            } else {
                current = test;
            }
        } catch (e) {
            // If widthOfTextAtSize still fails after sanitization,
            // skip this word but keep the current line
            console.warn('[PDF] Font measurement error for word, skipping:', w);
            if (current) {
                lines.push(current);
                current = '';
            }
        }
    }

    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
}

/**
 * Truncate text to fit within a maximum width, with sanitization.
 * Safe version that will never throw on font measurement errors.
 */
export function fitTextSafe(
    text: string | null | undefined,
    maxWidth: number,
    font: { widthOfTextAtSize: (text: string, size: number) => number },
    size: number
): string {
    const sanitized = sanitizePdfText(text);
    if (!sanitized) return '';

    try {
        if (font.widthOfTextAtSize(sanitized, size) <= maxWidth) {
            return sanitized;
        }

        const ellipsis = '...';
        let lo = 0;
        let hi = sanitized.length;

        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            const candidate = sanitized.substring(0, mid) + ellipsis;
            if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        const slice = Math.max(0, lo - 1);
        return slice <= 0 ? ellipsis : sanitized.substring(0, slice) + ellipsis;
    } catch (e) {
        console.warn('[PDF] Font measurement error, returning truncated text');
        // Fallback: return first 50 chars + ellipsis
        return sanitized.length > 50 ? sanitized.substring(0, 47) + '...' : sanitized;
    }
}
