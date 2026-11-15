//! Prompt Rewrite Module
//!
//! Provides configurable, sequential, strict literal string matching and replacement
//! for prompt sanitization without regex evaluation.

use crate::proxy::config::PromptRewriteRule;
use regex::Regex;
use std::sync::LazyLock;

/// Fenced code block regex (` ```...``` `) for protecting user message code blocks
static RE_FENCED_CODE_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?ms)```[\s\S]*?```").unwrap());

/// Placeholder regex for restoring protected fenced code blocks
static RE_FENCED_PLACEHOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"__PROMPT_REWRITE_CODE_BLOCK_(\d+)__").unwrap());

/// Compiled PromptRewriter for sequential, strict literal string replacement.
#[derive(Debug, Clone)]
pub struct PromptRewriter {
    active_rules: Vec<PromptRewriteRule>,
}

impl PromptRewriter {
    /// Constructs a `PromptRewriter` from a slice of rules.
    ///
    /// Filters out disabled rules and rules with empty match text (`r#match.is_empty()`).
    /// Returns `None` if no active rules remain.
    pub fn from_rules(rules: &[PromptRewriteRule]) -> Option<Self> {
        let active_rules: Vec<PromptRewriteRule> = rules
            .iter()
            .filter(|r| r.enabled && !r.r#match.is_empty())
            .cloned()
            .collect();

        if active_rules.is_empty() {
            None
        } else {
            Some(Self { active_rules })
        }
    }

    /// Returns the active rules.
    pub fn active_rules(&self) -> &[PromptRewriteRule] {
        &self.active_rules
    }

    /// Performs sequential exact substring replacement on `text`.
    ///
    /// Fast path: if no active rule matches `text`, returns `(text.to_string(), false)`.
    /// Otherwise executes replacements in rule order and returns `(rewritten_text, true)`.
    pub fn apply_to_text(&self, text: &str) -> (String, bool) {
        if !self.active_rules.iter().any(|r| text.contains(&r.r#match)) {
            return (text.to_string(), false);
        }

        let mut current = text.to_string();
        let mut modified = false;
        for rule in &self.active_rules {
            if current.contains(&rule.r#match) {
                current = current.replace(&rule.r#match, &rule.replace);
                modified = true;
            }
        }

        (current, modified)
    }

    /// Performs sequential exact substring replacement on `text`, strictly protecting
    /// fenced code blocks (` ```...``` `) from being modified.
    pub fn apply_to_text_protecting_fenced_code(&self, text: &str) -> (String, bool) {
        if !self.active_rules.iter().any(|r| text.contains(&r.r#match)) {
            return (text.to_string(), false);
        }

        // Fast path: if no fenced code block exists, run directly
        if !text.contains("```") {
            return self.apply_to_text(text);
        }

        // Protect fenced code blocks
        let mut placeholders: Vec<String> = Vec::new();
        let protected = RE_FENCED_CODE_BLOCK.replace_all(text, |caps: &regex::Captures| {
            let idx = placeholders.len();
            placeholders.push(caps[0].to_string());
            format!("__PROMPT_REWRITE_CODE_BLOCK_{}__", idx)
        });

        let (rewritten, modified) = self.apply_to_text(&protected);
        if !modified {
            return (text.to_string(), false);
        }

        // Restore fenced code blocks
        let restored = RE_FENCED_PLACEHOLDER.replace_all(&rewritten, |caps: &regex::Captures| {
            if let Ok(idx) = caps[1].parse::<usize>() {
                if let Some(code) = placeholders.get(idx) {
                    return code.clone();
                }
            }
            caps[0].to_string()
        });

        (restored.into_owned(), true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_or_disabled_rules_ignored() {
        let rules = vec![
            PromptRewriteRule {
                enabled: false,
                r#match: "hello".to_string(),
                replace: "world".to_string(),
            },
            PromptRewriteRule {
                enabled: true,
                r#match: "".to_string(),
                replace: "something".to_string(),
            },
        ];
        assert!(PromptRewriter::from_rules(&rules).is_none());
        assert!(PromptRewriter::from_rules(&[]).is_none());
    }

    #[test]
    fn test_strict_case_sensitivity() {
        let rules = vec![PromptRewriteRule {
            enabled: true,
            r#match: "Foo".to_string(),
            replace: "Bar".to_string(),
        }];
        let rewriter = PromptRewriter::from_rules(&rules).expect("rewriter should build");

        // "Foo" matches and becomes "Bar"
        let (out1, mod1) = rewriter.apply_to_text("Prefix Foo Suffix");
        assert!(mod1);
        assert_eq!(out1, "Prefix Bar Suffix");

        // "foo" and "FOO" do NOT match
        let (out2, mod2) = rewriter.apply_to_text("Prefix foo FOO Suffix");
        assert!(!mod2);
        assert_eq!(out2, "Prefix foo FOO Suffix");
    }

    #[test]
    fn test_regex_metacharacters_treated_literally() {
        let rules = vec![
            PromptRewriteRule {
                enabled: true,
                r#match: "[a-z]+".to_string(),
                replace: "LETTERS".to_string(),
            },
            PromptRewriteRule {
                enabled: true,
                r#match: "(foo|bar)".to_string(),
                replace: "CHOICE".to_string(),
            },
            PromptRewriteRule {
                enabled: true,
                r#match: "$1".to_string(),
                replace: "DOLLAR_ONE".to_string(),
            },
        ];
        let rewriter = PromptRewriter::from_rules(&rules).expect("rewriter should build");

        let input = "Pattern [a-z]+ and (foo|bar) with $1 variable.";
        let (out, modified) = rewriter.apply_to_text(input);
        assert!(modified);
        assert_eq!(out, "Pattern LETTERS and CHOICE with DOLLAR_ONE variable.");

        // Words matching the regex pattern semantically should NOT be replaced
        let regex_semantic = "hello world foo bar";
        let (out_sem, mod_sem) = rewriter.apply_to_text(regex_semantic);
        assert!(!mod_sem);
        assert_eq!(out_sem, regex_semantic);
    }

    #[test]
    fn test_deletion_when_replace_is_empty() {
        let rules = vec![PromptRewriteRule {
            enabled: true,
            r#match: "[SYSTEM_NOTE: internal]".to_string(),
            replace: "".to_string(),
        }];
        let rewriter = PromptRewriter::from_rules(&rules).expect("rewriter should build");

        let (out, modified) = rewriter.apply_to_text("Intro [SYSTEM_NOTE: internal] Outro");
        assert!(modified);
        assert_eq!(out, "Intro  Outro");
    }

    #[test]
    fn test_sequential_chaining() {
        let rules = vec![
            PromptRewriteRule {
                enabled: true,
                r#match: "A".to_string(),
                replace: "B".to_string(),
            },
            PromptRewriteRule {
                enabled: true,
                r#match: "B".to_string(),
                replace: "C".to_string(),
            },
        ];
        let rewriter = PromptRewriter::from_rules(&rules).expect("rewriter should build");

        let (out, modified) = rewriter.apply_to_text("A -> B");
        assert!(modified);
        // Step 1: "A -> B" becomes "B -> B"
        // Step 2: "B -> B" becomes "C -> C"
        assert_eq!(out, "C -> C");
    }

    #[test]
    fn test_fenced_code_block_protection() {
        let rules = vec![PromptRewriteRule {
            enabled: true,
            r#match: "Claude Code".to_string(),
            replace: "Gemini CLI".to_string(),
        }];
        let rewriter = PromptRewriter::from_rules(&rules).expect("rewriter should build");

        let input = "Use Claude Code for tasks:\n```bash\nclaude-code --version\n# Claude Code comment\n```\nThanks, Claude Code!";
        let (out, modified) = rewriter.apply_to_text_protecting_fenced_code(input);
        assert!(modified);

        // Outside code block replaced
        assert!(out.starts_with("Use Gemini CLI for tasks:"));
        assert!(out.ends_with("Thanks, Gemini CLI!"));

        // Inside code block strictly protected
        assert!(out.contains("```bash\nclaude-code --version\n# Claude Code comment\n```"));
    }

    #[test]
    fn test_zero_allocation_fast_path() {
        let rules = vec![PromptRewriteRule {
            enabled: true,
            r#match: "TARGET_TEXT".to_string(),
            replace: "REPLACEMENT".to_string(),
        }];
        let rewriter = PromptRewriter::from_rules(&rules).expect("rewriter should build");

        let input = "This text has nothing to replace.";
        let (out, modified) = rewriter.apply_to_text(input);
        assert!(!modified);
        assert_eq!(out, input);

        let (out_code, mod_code) = rewriter.apply_to_text_protecting_fenced_code(input);
        assert!(!mod_code);
        assert_eq!(out_code, input);
    }
}
