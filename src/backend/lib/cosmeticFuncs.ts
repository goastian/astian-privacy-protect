/*!
 * Copyright (c) 2017-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Mostly copied from https://github.com/cliqz-oss/adblocker/blob/3564524e46d55641da8d8a9ef21456c1dec8e194/packages/adblocker/src/engine/bucket/cosmetic.ts
 */

import { CosmeticFilter } from '@ghostery/adblocker'

const DEFAULT_HIDDING_STYLE = 'display: none !important;'

/**
 * Given a list of CSS selectors, create a valid stylesheet ready to be
 * injected in the page. This also takes care to no create rules with too many
 * selectors for Chrome, see: https://crbug.com/804179
 */
export function createStylesheet(rules: string[], style: string): string {
  if (rules.length === 0) {
    return ''
  }

  const maximumNumberOfSelectors = 100
  const parts: string[] = []
  const styleStr = ` { ${style} }`

  for (let i = 0; i < rules.length; i += maximumNumberOfSelectors) {
    // Accumulate up to `maximumNumberOfSelectors` selectors into `selector`.
    // We use string concatenation here since it's faster than using
    // `Array.prototype.join`.
    let selector = rules[i]
    for (
      let j = i + 1, end = Math.min(rules.length, i + maximumNumberOfSelectors);
      j < end;
      j += 1
    ) {
      selector += ',\n' + rules[j]
    }

    // Insert CSS after last selector (e.g.: `{ display: none }`)
    selector += styleStr

    // If `rules` has less than the limit, we can short-circuit here
    if (rules.length < maximumNumberOfSelectors) {
      return selector
    }

    // Keep track of this chunk and process next ones
    parts.push(selector)
  }

  // Join all chunks together
  return parts.join('\n')
}

/**
 * If at least one filter from `rules` has a custom style (e.g.: `##.foo
 * :style(...)`) then we fallback to `createStylesheetFromRulesWithCustomStyles`
 * which is slower than `createStylesheetFromRules`.
 */
export function createStylesheetFromRulesWithCustomStyles(
  rules: CosmeticFilter[]
): string {
  const selectorsPerStyle: Map<string, string[]> = new Map()

  for (const rule of rules) {
    const style = rule.getStyle()
    const selectors = selectorsPerStyle.get(style)
    if (selectors === undefined) {
      selectorsPerStyle.set(style, [rule.getSelector()])
    } else {
      selectors.push(rule.getSelector())
    }
  }

  const stylesheets: string[] = []
  const selectorsPerStyleArray = Array.from(selectorsPerStyle.entries())
  for (const [style, selectors] of selectorsPerStyleArray) {
    stylesheets.push(createStylesheet(selectors, style))
  }

  return stylesheets.join('\n\n')
}

/**
 * Given a list of cosmetic filters, create a stylesheet ready to be injected.
 * This function is optimistic and will assume there is no `:style` filter in
 * `rules`. In case one is found on the way, we fallback to the slower
 * `createStylesheetFromRulesWithCustomStyles` function.
 */
export function createStylesheetFromRules(rules: CosmeticFilter[]): string {
  const selectors: string[] = []
  for (const rule of rules) {
    if (rule.hasCustomStyle()) {
      return createStylesheetFromRulesWithCustomStyles(rules)
    }

    selectors.push(rule.selector)
  }

  return createStylesheet(selectors, DEFAULT_HIDDING_STYLE)
}
