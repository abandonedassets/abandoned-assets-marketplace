/**
 * DETERMINISTIC EXTRACTION PIPELINE
 * 
 * Principle: NO INFERENCE. NO GUESSING. EVIDENCE ONLY.
 * 
 * Every extracted value must have:
 * - field: the field name
 * - value: the extracted string/date
 * - confidence: 1.0 if exact match, 0 if null
 * - source_document: PDF/email filename
 * - page: page number (if PDF)
 * - matched_text: the raw text we matched on
 */

const EXTRACTION_KEYWORDS = {
  closing_date: [
    'Closing Date',
    'Settlement Date',
    'Close Date',
    'Scheduled Closing',
  ],
  executed_date: [
    'Executed',
    'Signed',
    'Date Signed',
    'Execution Date',
  ],
  funding_date: [
    'Disbursed',
    'Wire Sent',
    'Funded',
    'Funding Date',
    'Wire Date',
  ],
  buyer: [
    'Buyer',
    'Purchaser',
    'Borrower',
  ],
  seller: [
    'Seller',
    'Vendor',
    'Lender',
  ],
  assignment_fee: [
    'Assignment Fee',
    'Assignment Amount',
    'Fee Amount',
  ],
  purchase_price: [
    'Purchase Price',
    'Sale Price',
    'Contract Price',
  ],
};

/**
 * Parse ISO dates, MM/DD/YYYY, and Month Day, Year formats
 * Returns ISO 8601 string or NULL if unparseable
 */
function parseDate(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;

  dateString = dateString.trim();

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateString)) {
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }

  // MM/DD/YYYY
  const mmddyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateString);
  if (mmddyyyy) {
    const [, m, d, y] = mmddyyyy;
    const date = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
  }

  // Month Day, Year (e.g., "July 6, 2026")
  const mdy = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(dateString);
  if (mdy) {
    const [, month, day, year] = mdy;
    const date = new Date(`${month} ${day}, ${year}`);
    return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Extract a field using keyword matching
 * Returns { field, value, confidence, matched_text, source_document, page }
 * If no match: confidence = 0, value = null, review_required = true
 */
function extractField(documentText, fieldName, keywords, sourceDocument = 'UNKNOWN', pageNumber = null) {
  const result = {
    field: fieldName,
    value: null,
    confidence: 0,
    source_document: sourceDocument,
    page: pageNumber,
    matched_text: null,
    review_required: true,
  };

  if (!documentText || !keywords || keywords.length === 0) {
    return result;
  }

  // Search for each keyword in the document
  for (const keyword of keywords) {
    // Build regex: "Keyword: <value>"
    const regex = new RegExp(`${keyword}\\s*:?\\s*([^\\n]+)`, 'i');
    const match = regex.exec(documentText);

    if (match && match[1]) {
      const rawValue = match[1].trim();

      // Extract just the value (up to next sentence/newline)
      const cleanValue = rawValue.split(/[;,\n]/)[0].trim();

      // For dates, parse and validate
      if (fieldName.includes('date')) {
        const parsedDate = parseDate(cleanValue);
        if (parsedDate) {
          result.value = parsedDate;
          result.confidence = 1.0;
          result.matched_text = match[0];
          result.review_required = false;
          return result;
        }
      }

      // For other fields, return as-is if non-empty
      if (cleanValue.length > 0) {
        result.value = cleanValue;
        result.confidence = 1.0;
        result.matched_text = match[0];
        result.review_required = false;
        return result;
      }
    }
  }

  // No match found
  return result;
}

/**
 * Extract ALL fields from a document
 */
function extractAllFields(documentText, sourceDocument = 'UNKNOWN', pageNumber = null) {
  const extractions = {};

  for (const [fieldName, keywords] of Object.entries(EXTRACTION_KEYWORDS)) {
    extractions[fieldName] = extractField(
      documentText,
      fieldName,
      keywords,
      sourceDocument,
      pageNumber
    );
  }

  return extractions;
}

/**
 * Apply 30-day safety window
 * Returns: { is_valid, warning }
 */
function validateDateRange(isoDateString, fieldName) {
  if (!isoDateString) {
    return { is_valid: false, warning: `${fieldName} is NULL. Review required.` };
  }

  const extractedDate = new Date(isoDateString);
  const today = new Date();
  const diffTime = Math.abs(extractedDate.getTime() - today.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 30 && extractedDate < today) {
    return {
      is_valid: false,
      warning: `${fieldName} is ${diffDays} days in the past. Review required.`,
    };
  }

  if (diffDays > 30 && extractedDate > today) {
    return {
      is_valid: false,
      warning: `${fieldName} is ${diffDays} days in the future. Review required.`,
    };
  }

  return { is_valid: true, warning: null };
}

module.exports = {
  extractField,
  extractAllFields,
  parseDate,
  validateDateRange,
  EXTRACTION_KEYWORDS,
};
