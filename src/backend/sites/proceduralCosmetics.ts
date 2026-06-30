export type ProceduralOperator = {
  type: string
  arg: string
}

export type ProceduralAction =
  | { type: 'remove' }
  | { type: 'style'; arg: string }
  | { type: 'remove-attr'; arg: string }
  | { type: 'remove-class'; arg: string }

export type ProceduralFilter = {
  selector: ProceduralOperator[]
  action?: ProceduralAction
}

export type ProceduralFilterStats = {
  affected: number
  evaluatedFilters: number
  cappedFilters: number
  rejectedStyleActions: number
}

const MAX_CANDIDATES_PER_FILTER = 250
const MAX_XPATH_RESULTS = 100
const MAX_SELECTOR_LENGTH = 2048
const MAX_TEXT_PATTERN_LENGTH = 512
const HIDDEN_ATTRIBUTE = 'data-midori-rust-cosmetic-hidden'

const OPERATOR_NAMES: Record<string, string> = {
  CssSelector: 'css-selector',
  cssSelector: 'css-selector',
  HasText: 'has-text',
  MatchesAttr: 'matches-attr',
  MatchesCss: 'matches-css',
  MatchesCssBefore: 'matches-css-before',
  MatchesCssAfter: 'matches-css-after',
  MatchesPath: 'matches-path',
  MinTextLength: 'min-text-length',
  Upward: 'upward',
  Xpath: 'xpath',
}

const normalizeOperatorType = (type: string) => OPERATOR_NAMES[type] || type

export const parseProceduralFilter = (
  rawFilter: string
): ProceduralFilter | undefined => {
  try {
    const filter = JSON.parse(rawFilter) as ProceduralFilter
    if (!Array.isArray(filter.selector)) return undefined

    const selector = filter.selector
      .filter((operator) => operator && typeof operator.type === 'string')
      .map((operator) => ({
        type: normalizeOperatorType(operator.type),
        arg: typeof operator.arg === 'string' ? operator.arg : '',
      }))

    if (!selector.length) return undefined
    return { ...filter, selector }
  } catch {
    return undefined
  }
}

export const applyProceduralFilter = (
  filter: ProceduralFilter,
  root: ParentNode = document
): ProceduralFilterStats => {
  let elements = resolveProceduralSelector(filter.selector, root)
  if (!elements.length) return emptyStats(1)

  const unique = uniqueElements(elements)
  const cappedFilters = unique.length > MAX_CANDIDATES_PER_FILTER ? 1 : 0
  elements = unique.slice(0, MAX_CANDIDATES_PER_FILTER)

  let affected = 0
  let rejectedStyleActions = 0
  elements.forEach((element) => {
    const result = applyProceduralAction(element, filter.action)
    if (result.applied) affected++
    if (result.rejectedStyle) rejectedStyleActions++
  })

  return {
    affected,
    evaluatedFilters: 1,
    cappedFilters,
    rejectedStyleActions,
  }
}

export const applyProceduralFilters = (
  filters: ProceduralFilter[],
  root: ParentNode = document
) => applyProceduralFiltersWithStats(filters, root).affected

export const applyProceduralFiltersWithStats = (
  filters: ProceduralFilter[],
  root: ParentNode = document
): ProceduralFilterStats =>
  filters.reduce((stats, filter) => {
    const next = applyProceduralFilter(filter, root)
    return mergeStats(stats, next)
  }, emptyStats())

const resolveProceduralSelector = (
  operators: ProceduralOperator[],
  root: ParentNode
): Element[] => {
  let current: Element[] = []

  for (const operator of operators) {
    switch (operator.type) {
      case 'css-selector':
        current = queryCssSelector(operator.arg, current, root)
        break
      case 'has-text':
        current = filterByText(current, operator.arg)
        break
      case 'matches-attr':
        current = filterByAttribute(current, operator.arg)
        break
      case 'matches-css':
        current = filterByComputedStyle(current, operator.arg)
        break
      case 'matches-css-before':
        current = filterByComputedStyle(current, operator.arg, '::before')
        break
      case 'matches-css-after':
        current = filterByComputedStyle(current, operator.arg, '::after')
        break
      case 'matches-path':
        current = matchesPath(operator.arg) ? current : []
        break
      case 'min-text-length':
        current = filterByMinTextLength(current, operator.arg)
        break
      case 'upward':
        current = resolveUpward(current, operator.arg)
        break
      case 'xpath':
        current = resolveXPath(operator.arg, current, root)
        break
      default:
        return []
    }

    if (!current.length) return []
  }

  return current
}

const queryCssSelector = (
  selector: string,
  current: Element[],
  root: ParentNode
): Element[] => {
  if (!selector.trim() || selector.length > MAX_SELECTOR_LENGTH) return []

  try {
    if (!current.length) return Array.from(root.querySelectorAll(selector))

    return current.flatMap((element) =>
      Array.from(element.querySelectorAll(selector))
    )
  } catch {
    return []
  }
}

const filterByText = (elements: Element[], rawPattern: string) => {
  const matcher = createTextMatcher(rawPattern)
  if (!matcher) return []

  return elements.filter((element) => matcher(element.textContent || ''))
}

const filterByAttribute = (elements: Element[], rawPattern: string) => {
  const parsed = parseAttributeMatcher(rawPattern)
  if (!parsed) return []

  return elements.filter((element) => {
    const value = element.getAttribute(parsed.name)
    return typeof value === 'string' && parsed.matcher(value)
  })
}

const filterByComputedStyle = (
  elements: Element[],
  rawPattern: string,
  pseudoElement?: string
) => {
  const parsed = parseStyleMatcher(rawPattern)
  if (!parsed) return []

  return elements.filter((element) => {
    try {
      const styles = window.getComputedStyle(element, pseudoElement)
      return parsed.matcher(styles.getPropertyValue(parsed.property).trim())
    } catch {
      return false
    }
  })
}

const matchesPath = (rawPattern: string) => {
  const matcher = createTextMatcher(rawPattern)
  return matcher
    ? matcher(window.location.pathname + window.location.search)
    : false
}

const filterByMinTextLength = (elements: Element[], rawLength: string) => {
  const minLength = Number.parseInt(rawLength, 10)
  if (!Number.isFinite(minLength) || minLength <= 0) return []

  return elements.filter(
    (element) => (element.textContent || '').trim().length >= minLength
  )
}

const resolveUpward = (elements: Element[], arg: string) => {
  const distance = Number.parseInt(arg, 10)

  if (Number.isFinite(distance) && distance > 0 && distance <= 8) {
    return elements
      .map((element) => {
        let current: Element | null = element
        for (let i = 0; i < distance; i++)
          current = current?.parentElement || null
        return current
      })
      .filter(Boolean) as Element[]
  }

  if (!arg.trim() || arg.length > MAX_SELECTOR_LENGTH) return []

  return elements
    .map((element) => {
      try {
        return element.closest(arg)
      } catch {
        return null
      }
    })
    .filter(Boolean) as Element[]
}

const resolveXPath = (xpath: string, current: Element[], root: ParentNode) => {
  if (!xpath.trim() || xpath.length > MAX_SELECTOR_LENGTH) return []

  const contexts = current.length ? current : [root]
  const matches: Element[] = []

  contexts.forEach((context) => {
    if (matches.length >= MAX_XPATH_RESULTS) return

    try {
      const result = document.evaluate(
        xpath,
        context,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      )

      const length = Math.min(
        result.snapshotLength,
        MAX_XPATH_RESULTS - matches.length
      )
      for (let i = 0; i < length; i++) {
        const node = result.snapshotItem(i)
        if (node instanceof Element) matches.push(node)
      }
    } catch {
      // Ignore malformed or unsupported XPath filters.
    }
  })

  return matches
}

const applyProceduralAction = (element: Element, action?: ProceduralAction) => {
  if (!action || action.type === 'remove') {
    if (element.getAttribute(HIDDEN_ATTRIBUTE) === 'true') {
      return { applied: false, rejectedStyle: false }
    }
    element.setAttribute(HIDDEN_ATTRIBUTE, 'true')
    element.remove()
    return { applied: true, rejectedStyle: false }
  }

  if (action.type === 'style' && element instanceof HTMLElement) {
    if (!isSafeInlineStyle(action.arg)) {
      return { applied: false, rejectedStyle: true }
    }
    const before = element.getAttribute('style') || ''
    const nextStyle = [before.trim(), action.arg.trim()]
      .filter(Boolean)
      .join('; ')
    element.style.cssText = nextStyle
    return {
      applied: before !== (element.getAttribute('style') || ''),
      rejectedStyle: false,
    }
  }

  if (action.type === 'remove-attr' && isSafeToken(action.arg)) {
    if (!element.hasAttribute(action.arg)) {
      return { applied: false, rejectedStyle: false }
    }
    element.removeAttribute(action.arg)
    return { applied: true, rejectedStyle: false }
  }

  if (action.type === 'remove-class' && isSafeToken(action.arg)) {
    const hadClass = element.classList.contains(action.arg)
    element.classList.remove(action.arg)
    return { applied: hadClass, rejectedStyle: false }
  }

  return { applied: false, rejectedStyle: false }
}

const createTextMatcher = (rawPattern: string) => {
  const pattern = unwrapCssString(rawPattern.trim())
  if (!pattern || pattern.length > MAX_TEXT_PATTERN_LENGTH) return undefined

  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const lastSlash = pattern.lastIndexOf('/')
    const source = pattern.slice(1, lastSlash)
    const flags = pattern.slice(lastSlash + 1).replace(/[^imu]/g, '')
    try {
      const regexp = new RegExp(source, flags)
      return (value: string) => regexp.test(value)
    } catch {
      return undefined
    }
  }

  const needle = pattern.toLowerCase()
  return (value: string) => value.toLowerCase().includes(needle)
}

const parseStyleMatcher = (rawPattern: string) => {
  const separatorIndex = rawPattern.indexOf(':')
  if (separatorIndex <= 0) return undefined

  const property = rawPattern.slice(0, separatorIndex).trim().toLowerCase()
  const rawValue = rawPattern.slice(separatorIndex + 1).trim()
  if (!isSafeCssProperty(property)) return undefined

  const matcher = createTextMatcher(rawValue)
  return matcher ? { property, matcher } : undefined
}

const parseAttributeMatcher = (rawPattern: string) => {
  const separatorIndex = rawPattern.indexOf('=')
  const name = (
    separatorIndex >= 0 ? rawPattern.slice(0, separatorIndex) : rawPattern
  ).trim()
  if (!isSafeToken(name)) return undefined

  const matcher =
    separatorIndex >= 0
      ? createTextMatcher(rawPattern.slice(separatorIndex + 1).trim())
      : (value: string) => value.length > 0

  return matcher ? { name, matcher } : undefined
}

const unwrapCssString = (value: string) => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

const isSafeCssProperty = (property: string) =>
  /^-?[a-z][a-z0-9-]{0,80}$/.test(property)

const isSafeToken = (token: string) => /^[A-Za-z_][\w:-]{0,120}$/.test(token)

const isSafeInlineStyle = (style: string) =>
  style.length <= 2048 &&
  !/url\s*\(|image-set\s*\(|expression\s*\(|@import|\/\*/i.test(style)

const uniqueElements = (elements: Element[]) => Array.from(new Set(elements))

const emptyStats = (evaluatedFilters = 0): ProceduralFilterStats => ({
  affected: 0,
  evaluatedFilters,
  cappedFilters: 0,
  rejectedStyleActions: 0,
})

const mergeStats = (
  current: ProceduralFilterStats,
  next: ProceduralFilterStats
): ProceduralFilterStats => ({
  affected: current.affected + next.affected,
  evaluatedFilters: current.evaluatedFilters + next.evaluatedFilters,
  cappedFilters: current.cappedFilters + next.cappedFilters,
  rejectedStyleActions:
    current.rejectedStyleActions + next.rejectedStyleActions,
})
