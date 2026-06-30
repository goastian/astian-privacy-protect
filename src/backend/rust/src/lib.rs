use adblock::{
    lists::{FilterSet, ParseOptions},
    request::Request,
    resources::Resource,
    Engine,
};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;
#[cfg(debug_assertions)]
use web_sys::console;

// When the `wee_alloc` feature is enabled, this uses `wee_alloc` as the global
// allocator.
//
// If you don't want to use `wee_alloc`, you can safely delete this.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

// This is like the `main` function, except for JavaScript.
#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    // This provides better error messages in debug mode.
    // It's disabled in release mode so it doesn't bloat up the file size.
    #[cfg(debug_assertions)]
    console_error_panic_hook::set_once();

    #[cfg(debug_assertions)]
    console::log_1(&JsValue::from_str("Midori Privacy adblock core loaded"));

    Ok(())
}

#[wasm_bindgen]
pub fn engine_name() -> String {
    "midori-privacy-adblock-core/adblock-rust".to_string()
}

#[wasm_bindgen]
pub struct MidoriAdblockEngine {
    engine: Engine,
    rule_count: usize,
    resource_count: usize,
}

#[wasm_bindgen]
impl MidoriAdblockEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(rules: String, resources_json: String) -> Result<MidoriAdblockEngine, JsValue> {
        let rule_lines = parse_rule_lines(&rules);
        let rule_count = rule_lines.len();
        let resources = parse_resources(&resources_json)?;
        let resource_count = resources.len();
        let mut engine = build_engine(rule_lines);
        engine.use_resources(resources);

        Ok(MidoriAdblockEngine {
            engine,
            rule_count,
            resource_count,
        })
    }

    pub fn from_serialized(
        serialized: Vec<u8>,
        resources_json: String,
        rule_count: usize,
    ) -> Result<MidoriAdblockEngine, JsValue> {
        let resources = parse_resources(&resources_json)?;
        let resource_count = resources.len();
        let mut engine = Engine::default();
        engine
            .deserialize(&serialized)
            .map_err(|error| JsValue::from_str(&format!("Invalid serialized engine: {error:?}")))?;
        engine.use_resources(resources);

        Ok(MidoriAdblockEngine {
            engine,
            rule_count,
            resource_count,
        })
    }

    pub fn serialize(&self) -> Vec<u8> {
        self.engine.serialize()
    }

    pub fn check_network_request(
        &self,
        url: String,
        source_url: String,
        request_type: String,
    ) -> Result<bool, JsValue> {
        let request = Request::new(&url, &source_url, &request_type)
            .map_err(|error| JsValue::from_str(&format!("Invalid request: {error:?}")))?;

        Ok(self.engine.check_network_request(&request).matched)
    }

    pub fn network_decision_json(
        &self,
        url: String,
        source_url: String,
        request_type: String,
    ) -> Result<String, JsValue> {
        let request = Request::new(&url, &source_url, &request_type)
            .map_err(|error| JsValue::from_str(&format!("Invalid request: {error:?}")))?;
        let result = self.engine.check_network_request(&request);

        serde_json::to_string(&serde_json::json!({
            "matched": result.matched,
            "redirect": result.redirect,
            "rewrittenUrl": result.rewritten_url,
            "filter": result.filter,
        }))
        .map_err(|error| JsValue::from_str(&format!("Could not serialize decision: {error}")))
    }

    pub fn cosmetic_resources_json(&self, url: String) -> Result<String, JsValue> {
        let resources = self.engine.url_cosmetic_resources(&url);
        let hide_selectors = sorted_strings(resources.hide_selectors.iter());
        let procedural_actions = sorted_strings(resources.procedural_actions.iter());
        let exceptions = sorted_strings(resources.exceptions.iter());

        serde_json::to_string(&serde_json::json!({
            "hideSelectors": hide_selectors,
            "stylesheet": selectors_to_stylesheet(&hide_selectors),
            "proceduralActions": procedural_actions,
            "exceptions": exceptions,
            "injectedScript": resources.injected_script,
            "generichide": resources.generichide,
        }))
        .map_err(|error| {
            JsValue::from_str(&format!("Could not serialize cosmetic resources: {error}"))
        })
    }

    pub fn generic_selectors_json(
        &self,
        classes_json: String,
        ids_json: String,
        exceptions_json: String,
    ) -> Result<String, JsValue> {
        let classes = parse_string_vec(&classes_json, "classes")?;
        let ids = parse_string_vec(&ids_json, "ids")?;
        let exceptions: HashSet<String> = parse_string_vec(&exceptions_json, "exceptions")?
            .into_iter()
            .collect();
        let hide_selectors =
            self.engine
                .hidden_class_id_selectors(classes.iter(), ids.iter(), &exceptions);

        serde_json::to_string(&serde_json::json!({
            "hideSelectors": hide_selectors,
            "stylesheet": selectors_to_stylesheet(&hide_selectors),
        }))
        .map_err(|error| {
            JsValue::from_str(&format!("Could not serialize generic selectors: {error}"))
        })
    }

    pub fn rule_count(&self) -> usize {
        self.rule_count
    }

    pub fn resource_count(&self) -> usize {
        self.resource_count
    }
}

#[wasm_bindgen]
pub fn matches_network_request(
    rules: String,
    url: String,
    source_url: String,
    request_type: String,
) -> Result<bool, JsValue> {
    let engine = build_engine(parse_rule_lines(&rules));
    let request = Request::new(&url, &source_url, &request_type)
        .map_err(|error| JsValue::from_str(&format!("Invalid request: {error:?}")))?;

    Ok(engine.check_network_request(&request).matched)
}

fn parse_rule_lines(rules: &str) -> Vec<String> {
    rules
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('!'))
        .map(ToOwned::to_owned)
        .collect()
}

fn build_engine(rule_lines: Vec<String>) -> Engine {
    let mut filter_set = FilterSet::new(false);
    filter_set.add_filters(&rule_lines, ParseOptions::default());
    Engine::from_filter_set(filter_set, true)
}

fn parse_resources(resources_json: &str) -> Result<Vec<Resource>, JsValue> {
    if resources_json.trim().is_empty() {
        return Ok(vec![]);
    }

    serde_json::from_str(resources_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid resources JSON: {error}")))
}

fn parse_string_vec(input: &str, label: &str) -> Result<Vec<String>, JsValue> {
    if input.trim().is_empty() {
        return Ok(vec![]);
    }

    serde_json::from_str(input)
        .map_err(|error| JsValue::from_str(&format!("Invalid {label} JSON: {error}")))
}

fn sorted_strings<'a>(items: impl IntoIterator<Item = &'a String>) -> Vec<String> {
    let mut values: Vec<String> = items.into_iter().cloned().collect();
    values.sort();
    values
}

fn selectors_to_stylesheet(selectors: &[String]) -> String {
    selectors
        .iter()
        .map(|selector| format!("{selector} {{ display: none !important; }}"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::{matches_network_request, MidoriAdblockEngine};
    use serde_json::Value;

    fn procedural_actions(resources_json: &str) -> Vec<String> {
        let value: Value =
            serde_json::from_str(resources_json).expect("resources JSON should parse");
        value["proceduralActions"]
            .as_array()
            .expect("procedural actions should be an array")
            .iter()
            .map(|item| {
                item.as_str()
                    .expect("procedural action should be serialized JSON")
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn matches_basic_network_rule() {
        let matched = matches_network_request(
            "||ads.example.com^".to_string(),
            "https://ads.example.com/banner.js".to_string(),
            "https://publisher.example/".to_string(),
            "script".to_string(),
        )
        .expect("request should be valid");

        assert!(matched);
    }

    #[test]
    fn respects_exception_rule() {
        let matched = matches_network_request(
            "||ads.example.com^\n@@||ads.example.com/allowed.js".to_string(),
            "https://ads.example.com/allowed.js".to_string(),
            "https://publisher.example/".to_string(),
            "script".to_string(),
        )
        .expect("request should be valid");

        assert!(!matched);
    }

    #[test]
    fn persistent_engine_matches_without_recompiling_rules() {
        let engine = MidoriAdblockEngine::new(
            "||ads.example.com^\n@@||ads.example.com/allowed.js".to_string(),
            "[]".to_string(),
        )
        .expect("engine should compile");

        assert_eq!(engine.rule_count(), 2);
        assert_eq!(engine.resource_count(), 0);
        assert!(engine
            .check_network_request(
                "https://ads.example.com/banner.js".to_string(),
                "https://publisher.example/".to_string(),
                "script".to_string(),
            )
            .expect("request should be valid"));
        assert!(!engine
            .check_network_request(
                "https://ads.example.com/allowed.js".to_string(),
                "https://publisher.example/".to_string(),
                "script".to_string(),
            )
            .expect("request should be valid"));
    }

    #[test]
    fn persistent_engine_accepts_brave_resource_json() {
        let resources = r#"[{
            "name":"noop.js",
            "aliases":["noop"],
            "kind":{"mime":"application/javascript"},
            "content":"Lyogbm9vcCAqLw=="
        }]"#;
        let engine =
            MidoriAdblockEngine::new("||ads.example.com^".to_string(), resources.to_string())
                .expect("engine should compile with resources");

        assert_eq!(engine.resource_count(), 1);
        let decision = engine
            .network_decision_json(
                "https://ads.example.com/banner.js".to_string(),
                "https://publisher.example/".to_string(),
                "script".to_string(),
            )
            .expect("decision should serialize");
        assert!(decision.contains("\"matched\":true"));
    }

    #[test]
    fn serialized_engine_round_trip_preserves_network_and_cosmetic_rules() {
        let resources = r#"[{
            "name":"noop.js",
            "aliases":["noop"],
            "kind":{"mime":"application/javascript"},
            "content":"Ow=="
        }]"#;
        let engine = MidoriAdblockEngine::new(
            "||ads.example.com/banner.js$script,redirect=noop.js\nexample.com##.sponsor"
                .to_string(),
            resources.to_string(),
        )
        .expect("engine should compile before serialization");

        let serialized = engine.serialize();
        assert!(!serialized.is_empty());

        let restored = MidoriAdblockEngine::from_serialized(serialized, resources.to_string(), 2)
            .expect("serialized engine should restore");
        let decision = restored
            .network_decision_json(
                "https://ads.example.com/banner.js".to_string(),
                "https://publisher.example/".to_string(),
                "script".to_string(),
            )
            .expect("decision should serialize");
        assert!(decision.contains("data:application/javascript;base64,Ow=="));

        let cosmetics = restored
            .cosmetic_resources_json("https://example.com/article".to_string())
            .expect("cosmetic resources should serialize after restore");
        assert!(cosmetics.contains(".sponsor"));
    }

    #[test]
    fn redirect_rules_return_replacement_resource() {
        let resources = r#"[{
            "name":"noop.js",
            "aliases":["noopjs"],
            "kind":{"mime":"application/javascript"},
            "content":"Ow=="
        }]"#;
        let engine = MidoriAdblockEngine::new(
            "||ads.example.com/banner.js$script,redirect=noop.js".to_string(),
            resources.to_string(),
        )
        .expect("engine should compile with redirect resources");

        let decision = engine
            .network_decision_json(
                "https://ads.example.com/banner.js".to_string(),
                "https://publisher.example/".to_string(),
                "script".to_string(),
            )
            .expect("decision should serialize");

        assert!(decision.contains("\"matched\":true"));
        assert!(decision.contains("data:application/javascript;base64,Ow=="));
    }

    #[test]
    fn removeparam_rules_return_rewritten_url_without_blocking() {
        let engine =
            MidoriAdblockEngine::new("*$removeparam=utm_source".to_string(), "[]".to_string())
                .expect("engine should compile removeparam rules");

        let decision = engine
            .network_decision_json(
                "https://news.example/article?utm_source=tracker&id=42".to_string(),
                "https://news.example/".to_string(),
                "document".to_string(),
            )
            .expect("decision should serialize");

        assert!(decision.contains("\"matched\":false"));
        assert!(decision.contains("https://news.example/article?id=42"));
    }

    #[test]
    fn cosmetic_resources_return_specific_stylesheet_and_exceptions() {
        let engine = MidoriAdblockEngine::new(
            "example.com##.sponsored\nexample.com#@#.allowed".to_string(),
            "[]".to_string(),
        )
        .expect("engine should compile cosmetic rules");

        let resources = engine
            .cosmetic_resources_json("https://example.com/article".to_string())
            .expect("cosmetic resources should serialize");

        assert!(resources.contains(".sponsored"));
        assert!(resources.contains("display: none !important"));
        assert!(resources.contains(".allowed"));
    }

    #[test]
    fn abp_style_injection_remove_rules_return_procedural_actions() {
        let engine = MidoriAdblockEngine::new(
            "example.com###remove-id {remove: true;}\n\
             example.com##div[style*=\"width: 45px;\"] {remove: true;}\n\
             chip.de##.ft-charts-main > div:not(.List):not(.caps) {remove:true;}"
                .to_string(),
            "[]".to_string(),
        )
        .expect("engine should compile ABP style injection remove rules");

        let resources = engine
            .cosmetic_resources_json("https://example.com/article".to_string())
            .expect("cosmetic resources should serialize");
        let actions = procedural_actions(&resources);

        assert!(actions
            .iter()
            .any(|action| action.contains("\"type\":\"remove\"") && action.contains("#remove-id")));
        assert!(actions
            .iter()
            .any(|action| action.contains("div[style*=\\\"width: 45px;\\\"]")));

        let chip_resources = engine
            .cosmetic_resources_json("https://chip.de/download".to_string())
            .expect("chip cosmetic resources should serialize");
        let chip_actions = procedural_actions(&chip_resources);
        assert!(chip_actions.iter().any(|action| action
            .contains(".ft-charts-main > div:not(.List):not(.caps)")
            && action.contains("\"type\":\"remove\"")));
    }

    #[test]
    fn abp_style_injection_style_rules_return_inline_style_actions() {
        let engine = MidoriAdblockEngine::new(
            "example.com###inline-css-id {background-color: #0dc74b;}\n\
             example.com##.ad {display: none;}"
                .to_string(),
            "[]".to_string(),
        )
        .expect("engine should compile ABP style injection style rules");

        let resources = engine
            .cosmetic_resources_json("https://example.com/article".to_string())
            .expect("cosmetic resources should serialize");
        let actions = procedural_actions(&resources);

        assert!(actions.iter().any(|action| {
            action.contains("\"type\":\"style\"") && action.contains("background-color: #0dc74b;")
        }));
        assert!(actions.iter().any(
            |action| action.contains("\"type\":\"style\"") && action.contains("display: none;")
        ));
    }

    #[test]
    fn cosmetic_resources_return_scriptlet_from_resources() {
        let resources = r#"[{
            "name":"noop.js",
            "aliases":["noop"],
            "kind":{"mime":"application/javascript"},
            "content":"d2luZG93Ll9fbWlkb3JpU2NyaXB0bGV0ID0gdHJ1ZTs="
        }]"#;
        let engine =
            MidoriAdblockEngine::new("example.com##+js(noop)".to_string(), resources.to_string())
                .expect("engine should compile scriptlet rules");

        let cosmetic_resources = engine
            .cosmetic_resources_json("https://example.com/article".to_string())
            .expect("cosmetic resources should serialize");

        assert!(cosmetic_resources.contains("__midoriScriptlet"));
    }

    #[test]
    fn generic_selectors_return_stylesheet_for_seen_classes() {
        let engine = MidoriAdblockEngine::new("##.ad-banner".to_string(), "[]".to_string())
            .expect("engine should compile generic cosmetic rules");

        let generic_resources = engine
            .generic_selectors_json(
                "[\"ad-banner\"]".to_string(),
                "[]".to_string(),
                "[]".to_string(),
            )
            .expect("generic selectors should serialize");

        assert!(generic_resources.contains(".ad-banner"));
        assert!(generic_resources.contains("display: none !important"));
    }
}
