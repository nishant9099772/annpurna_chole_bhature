/**
 * Customer Name & Mobile Number Formatting Utilities
 * - Automatically appends " Ji" to customer names without duplicating if already present.
 * - Formats full mobile numbers with country code (e.g., "+91 9876543210").
 * - Provides a reliable cross-browser & iframe-safe clipboard copy helper.
 */

/**
 * Formats a customer name so it always ends with " Ji".
 * Examples:
 *  - "Rahul" -> "Rahul Ji"
 *  - "Amit Kumar" -> "Amit Kumar Ji"
 *  - "Rahul Ji" -> "Rahul Ji"
 *  - "rahul ji" -> "rahul Ji"
 *  - "Amit Kumar ji." -> "Amit Kumar Ji"
 */
export function formatCustomerNameWithJi(rawName?: string | null): string {
  if (!rawName || typeof rawName !== 'string') return '';
  // Collapse multiple whitespace into single space and trim
  const cleaned = rawName.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  // Check if name already ends with "ji" as a separate word (case-insensitive, optional trailing period)
  if (/\bji\.?$/i.test(cleaned)) {
    // Normalize the trailing "ji" or "ji." to "Ji"
    return cleaned.replace(/\bji\.?$/i, 'Ji');
  }

  return `${cleaned} Ji`;
}

/**
 * Formats the complete mobile number including country code.
 * Example: ("+91", "9876543210") -> "+91 9876543210"
 */
export function formatFullMobileNumber(countryCode?: string | null, mobileNumber?: string | null): string {
  const cleanMobile = (mobileNumber || '').trim();
  if (!cleanMobile) return '';

  let cleanCode = (countryCode || '+91').trim();
  if (cleanCode && !cleanCode.startsWith('+')) {
    cleanCode = `+${cleanCode}`;
  }

  // Avoid duplicating country code if mobileNumber already starts with it
  if (cleanMobile.startsWith(cleanCode)) {
    return cleanMobile;
  }

  return `${cleanCode} ${cleanMobile}`.trim();
}

/**
 * Copies text to clipboard with fallback for restricted iframe contexts.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to textarea method below
  }

  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    }
  } catch {
    return false;
  }

  return false;
}
