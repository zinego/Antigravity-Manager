//! Zero-Width Space Sensitive Word Obfuscation Module
//!
//! Provides CPA-style zero-width character (`\u{200B}`) insertion for sensitive words
//! to prevent keyword triggering without breaking model instruction semantics.

use regex::Regex;
use std::sync::LazyLock;

/// Unicode zero-width space character (`U+200B`)
pub const ZERO_WIDTH_SPACE: &str = "\u{200B}";

/// Fenced code block regex (` ```...``` `) for protecting user message code blocks
static RE_FENCED_CODE_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?ms)```[\s\S]*?```").unwrap());

/// Placeholder regex for restoring protected fenced code blocks
static RE_FENCED_PLACEHOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"__OBFUSCATE_FENCED_CODE_BLOCK_(\d+)__").unwrap());

/// Compiled matcher for sensitive word obfuscation.
#[derive(Debug)]
pub struct SensitiveWordMatcher {
    regex: Regex,
}

impl SensitiveWordMatcher {
    /// Builds a matcher from a list of sensitive words.
    ///
    /// Rules:
    /// 1. Trim whitespace;
    /// 2. Filter out empty, `< 2` unicode scalar values, or words already containing `\u{200B}`;
    /// 3. Deduplicate case-insensitively while keeping original strings;
    /// 4. Sort by byte length descending (`b.len().cmp(&a.len())`) so longer phrases match before substrings;
    /// 5. Compile case-insensitive `(?i)` regex with `regex::escape`.
    ///
    /// Returns `None` if no valid words remain.
    pub fn from_words(words: &[String]) -> Option<Self> {
        let mut valid_words: Vec<String> = Vec::new();
        let mut seen_lower = std::collections::HashSet::new();

        for w in words {
            let trimmed = w.trim();
            if trimmed.chars().count() < 2 || trimmed.contains(ZERO_WIDTH_SPACE) {
                continue;
            }
            let lower = trimmed.to_lowercase();
            if seen_lower.insert(lower) {
                valid_words.push(trimmed.to_string());
            }
        }

        if valid_words.is_empty() {
            return None;
        }

        // Sort descending by byte length so longer phrases match first
        valid_words.sort_by_key(|w| std::cmp::Reverse(w.len()));

        let escaped_patterns: Vec<String> = valid_words.iter().map(|w| regex::escape(w)).collect();

        let pattern = format!("(?i)(?:{})", escaped_patterns.join("|"));
        Regex::new(&pattern).ok().map(|regex| Self { regex })
    }

    /// Obfuscates occurrences of sensitive words in `text`.
    ///
    /// Returns `(obfuscated_text, replacement_count)`.
    /// If no matches occur, returns original string without allocation.
    pub fn obfuscate_text(&self, text: &str) -> (String, usize) {
        if !self.regex.is_match(text) {
            return (text.to_string(), 0);
        }

        let mut count = 0usize;
        let replaced = self.regex.replace_all(text, |caps: &regex::Captures| {
            count += 1;
            obfuscate_word(&caps[0])
        });

        (replaced.into_owned(), count)
    }

    /// Obfuscates occurrences of sensitive words in `text`, while strictly protecting
    /// fenced code blocks (` ```...``` `).
    ///
    /// Useful for user message prose where actual code snippets should stay intact.
    pub fn obfuscate_text_protecting_fenced_code(&self, text: &str) -> (String, usize) {
        if !self.regex.is_match(text) {
            return (text.to_string(), 0);
        }

        // Fast path: if no fenced code block exists, run directly
        if !text.contains("```") {
            return self.obfuscate_text(text);
        }

        // Protect fenced code blocks
        let mut placeholders: Vec<String> = Vec::new();
        let protected = RE_FENCED_CODE_BLOCK.replace_all(text, |caps: &regex::Captures| {
            let idx = placeholders.len();
            placeholders.push(caps[0].to_string());
            format!("__OBFUSCATE_FENCED_CODE_BLOCK_{}__", idx)
        });

        let mut count = 0usize;
        let replaced = self
            .regex
            .replace_all(&protected, |caps: &regex::Captures| {
                count += 1;
                obfuscate_word(&caps[0])
            });

        // Restore fenced code blocks
        let restored = RE_FENCED_PLACEHOLDER.replace_all(&replaced, |caps: &regex::Captures| {
            if let Ok(idx) = caps[1].parse::<usize>() {
                if let Some(code) = placeholders.get(idx) {
                    return code.clone();
                }
            }
            caps[0].to_string()
        });

        (restored.into_owned(), count)
    }
}

/// Inserts `\u{200B}` after the first Unicode character of `word`.
///
/// Rules:
/// - If `word` already contains `\u{200B}`, returns `word.to_string()`.
/// - If `word` has fewer than 2 characters, returns `word.to_string()`.
/// - Preserves exact casing and UTF-8 multibyte characters.
pub fn obfuscate_word(word: &str) -> String {
    if word.contains(ZERO_WIDTH_SPACE) {
        return word.to_string();
    }

    let mut chars = word.chars();
    let Some(first_char) = chars.next() else {
        return word.to_string();
    };

    let first_len = first_char.len_utf8();
    if first_len >= word.len() {
        return word.to_string();
    }

    let mut out = String::with_capacity(word.len() + ZERO_WIDTH_SPACE.len());
    out.push(first_char);
    out.push_str(ZERO_WIDTH_SPACE);
    out.push_str(&word[first_len..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_obfuscate_word_ascii() {
        assert_eq!(obfuscate_word("Proxy"), "P\u{200B}roxy");
        assert_eq!(obfuscate_word("claude"), "c\u{200B}laude");
        assert_eq!(obfuscate_word("AI"), "A\u{200B}I");
    }

    #[test]
    fn test_obfuscate_word_multibyte_cjk() {
        assert_eq!(obfuscate_word("代理"), "代\u{200B}理");
        assert_eq!(obfuscate_word("敏感词"), "敏\u{200B}感词");
    }

    #[test]
    fn test_obfuscate_word_single_char_or_empty() {
        assert_eq!(obfuscate_word(""), "");
        assert_eq!(obfuscate_word("A"), "A");
        assert_eq!(obfuscate_word("字"), "字");
    }

    #[test]
    fn test_obfuscate_word_idempotent() {
        let once = obfuscate_word("Proxy");
        assert_eq!(once, "P\u{200B}roxy");
        let twice = obfuscate_word(&once);
        assert_eq!(twice, once);
    }

    #[test]
    fn test_matcher_filters_and_dedup() {
        let words = vec![
            "a".to_string(),             // < 2 chars
            "".to_string(),              // empty
            "   ".to_string(),           // whitespace only
            "P\u{200B}roxy".to_string(), // already obfuscated
            "claude".to_string(),
            "Claude".to_string(), // duplicate (case-insensitive)
            "代理".to_string(),
        ];

        let matcher = SensitiveWordMatcher::from_words(&words).expect("should build matcher");
        let (out, count) = matcher.obfuscate_text("Hello Claude and 代理!");
        assert_eq!(count, 2);
        assert_eq!(out, "Hello C\u{200B}laude and 代\u{200B}理!");
    }

    #[test]
    fn test_matcher_longest_phrase_first() {
        let words = vec!["Claude".to_string(), "Claude Code".to_string()];

        let matcher = SensitiveWordMatcher::from_words(&words).expect("should build matcher");
        let (out, count) = matcher.obfuscate_text("Using Claude Code today");
        assert_eq!(count, 1);
        assert_eq!(out, "Using C\u{200B}laude Code today");
    }

    #[test]
    fn test_matcher_protect_fenced_code() {
        let words = vec!["proxy".to_string()];
        let matcher = SensitiveWordMatcher::from_words(&words).expect("should build matcher");

        let text = "Use proxy here.\n```python\nproxy = 'http://127.0.0.1'\nprint(proxy)\n```\nAnother proxy call.";
        let (out, count) = matcher.obfuscate_text_protecting_fenced_code(text);
        assert_eq!(count, 2);
        assert!(out.contains("p\u{200B}roxy here."));
        assert!(out.contains("Another p\u{200B}roxy call."));
        assert!(out.contains("proxy = 'http://127.0.0.1'"));
        assert!(out.contains("print(proxy)"));
    }
}
