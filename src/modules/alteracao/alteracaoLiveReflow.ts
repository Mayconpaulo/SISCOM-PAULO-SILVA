import {
  AlteracaoHtmlBlock,
  PART2_ITEM_LABEL_ONLY_RE,
  PART2_ITEM_WITH_TIME_RE,
  ParsedAlteracaoSectionItem,
  StructuredAlteracaoDoc,
  applyServiceTimeToPart2Lines,
  buildAlteracaoTableHtml,
  formatPart2DotRow,
  isAnyComportamentoLine,
  isComportamentoHeadingLine,
  isPart2CenteredFooterTrigger,
  isPart2ClosingDateLine,
  renderItemBlocksForInsertion,
  replaceDateInPart2ClosingLine,
} from './alteracaoFormatter';
import { PaginateOptions, paginateAlteracaoBlocksInDom } from './alteracaoFileReader';

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function isSpacerElement(el: HTMLElement): boolean {
  const tag = el.tagName.toUpperCase();
  if (tag === 'TABLE') return false;
  if (el.querySelector('table')) return false;
  const txt = (el.textContent || '').replace(/\u00a0/g, '').trim();
  return txt.length === 0;
}

function parsePageElements(html: string): HTMLElement[] {
  const doc = new DOMParser().parseFromString(html || '<p><br></p>', 'text/html');
  const result: HTMLElement[] = [];
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      result.push(node as HTMLElement);
    } else if (node.nodeType === Node.TEXT_NODE) {
      const txt = (node.textContent || '').trim();
      if (txt) {
        const p = doc.createElement('p');
        p.textContent = txt;
        result.push(p);
      }
    }
  }
  return result;
}

function isMonthHeadingEl(el: HTMLElement, monthName?: string): boolean {
  const attr = el.getAttribute('data-alt-month');
  if (attr) {
    return monthName ? normalizeKey(attr) === normalizeKey(monthName) : true;
  }
  if (el.tagName.toUpperCase() === 'TABLE') return false;
  const txt = normalizeKey(el.textContent || '');
  if (monthName) {
    const m = normalizeKey(monthName);
    return txt === `${m}:` || txt === m;
  }
  return /^(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO):?$/.test(
    txt
  );
}

function getMonthHeadingName(el: HTMLElement): string | null {
  const attr = el.getAttribute('data-alt-month');
  if (attr) return attr.toUpperCase();
  if (el.tagName.toUpperCase() === 'TABLE') return null;
  const txt = normalizeKey(el.textContent || '').replace(/:$/, '');
  const map: Record<string, string> = {
    JANEIRO: 'JANEIRO',
    FEVEREIRO: 'FEVEREIRO',
    MARCO: 'MARÇO',
    ABRIL: 'ABRIL',
    MAIO: 'MAIO',
    JUNHO: 'JUNHO',
    JULHO: 'JULHO',
    AGOSTO: 'AGOSTO',
    SETEMBRO: 'SETEMBRO',
    OUTUBRO: 'OUTUBRO',
    NOVEMBRO: 'NOVEMBRO',
    DEZEMBRO: 'DEZEMBRO',
  };
  return map[txt] ?? null;
}

function isSemAlteracaoEl(el: HTMLElement): boolean {
  if (el.hasAttribute('data-alt-sem-alt')) return true;
  const txt = normalizeKey(el.textContent || '');
  return txt === '- SEM ALTERACAO' || txt === 'SEM ALTERACAO';
}

function isHeadingKeepWithNext(el: HTMLElement): boolean {
  if (
    el.hasAttribute('data-alt-month') ||
    el.hasAttribute('data-alt-group') ||
    el.hasAttribute('data-alt-part2')
  ) {
    return true;
  }
  if (el.tagName.toUpperCase() === 'TABLE') return false;
  const txt = (el.textContent || '').trim();
  if (!txt) return false;
  if (isMonthHeadingEl(el)) return true;
  if (normalizeKey(txt) === '1A PARTE:' || normalizeKey(txt) === '2A PARTE') return true;
  if (/^[_\-–—]{5,}$/.test(txt)) return true;
  if (isComportamentoHeadingLine(txt)) return true;
  // Bold short subtitle or section heading line (never a bullet/BI entry or full sentence)
  if (/^[-–—•]\s*/.test(txt) || /[.;!?]$/.test(txt)) return false;
  const strong = el.querySelector('strong, b');
  if (strong && normalizeKey(strong.textContent || '') === normalizeKey(txt) && txt.length <= 120) {
    return true;
  }
  return false;
}

function extractTableMetaFromEl(tableEl: HTMLElement): AlteracaoHtmlBlock {
  const colgroupEl = tableEl.querySelector('colgroup');
  const colgroupHtml = colgroupEl ? colgroupEl.outerHTML : undefined;
  const trs = Array.from(tableEl.querySelectorAll('tr')) as HTMLElement[];
  const rowsHtml = trs.map((tr) => tr.outerHTML);
  const itemId = tableEl.getAttribute('data-alt-item') || undefined;
  const firstRow = trs[0];
  const hasHeaderCells = Boolean(
    firstRow &&
      (firstRow.querySelector('th') ||
        (firstRow.querySelectorAll('strong, b').length >= 2 && trs.length > 1))
  );
  const headerRowHtml = hasHeaderCells && rowsHtml.length > 1 ? rowsHtml[0] : undefined;

  if (rowsHtml.length === 0) {
    return { html: tableEl.outerHTML };
  }

  return {
    html: buildAlteracaoTableHtml(rowsHtml, itemId, colgroupHtml),
    tableMeta: {
      rowsHtml,
      colgroupHtml,
      headerRowHtml,
      itemId,
    },
  };
}

interface FlatNode {
  pageIndex: number;
  elIndex: number;
  el: HTMLElement;
  isNewPageBoundary?: boolean;
}

export const CARET_MARKER_ATTR = 'data-siscom-caret';

export interface LiveCaretBookmark {
  pageIndex: number;
  blockIndex: number;
  textOffset: number;
  isEmptyBlock: boolean;
}

export interface LiveReflowResult {
  changed: boolean;
  pagesHtml: string[];
  caret: LiveCaretBookmark | null;
}

function elementContainsCaretMarker(el: HTMLElement): boolean {
  return el.hasAttribute(CARET_MARKER_ATTR) || Boolean(el.querySelector(`[${CARET_MARKER_ATTR}]`));
}

function isPart2FooterElement(el: HTMLElement): boolean {
  if (el.tagName.toUpperCase() === 'TABLE') return false;
  const styleAttr = (el.getAttribute('style') || '').toLowerCase();
  const alignAttr = (el.getAttribute('align') || '').toLowerCase();
  if (/text-align\s*:\s*center/.test(styleAttr) || alignAttr === 'center') return true;
  const txt = (el.textContent || '').trim();
  return /^Quartel\b/i.test(txt) || /^[_\-–—]{5,}$/.test(txt);
}

function elementsToReflowBlocks(
  nodes: Array<{ el?: HTMLElement; block?: AlteracaoHtmlBlock; crossedPageBreak?: boolean }>,
  prefixEndedWithSpacer: boolean,
  opts?: { preserveUserSpacers?: boolean }
): AlteracaoHtmlBlock[] {
  const blocks: AlteracaoHtmlBlock[] = [];
  const preserveUserSpacers = Boolean(opts?.preserveUserSpacers);
  const spacer = (): AlteracaoHtmlBlock => ({ html: '<p><br></p>', isSpacer: true });

  const lastIsSpacer = () =>
    blocks.length > 0 ? Boolean(blocks[blocks.length - 1].isSpacer) : prefixEndedWithSpacer;

  const needsLeadingSpacerBeforeEl = (el: HTMLElement): boolean => {
    if (el.hasAttribute('data-alt-month') || isMonthHeadingEl(el)) return true;
    if (el.hasAttribute('data-alt-group')) return true;
    if (el.hasAttribute('data-alt-part2')) return true;
    return false;
  };

  const stripStaleAltAttrsFromSpacer = (spacerEl: HTMLElement): string => {
    const clone = spacerEl.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-alt-item');
    clone.removeAttribute('data-alt-group');
    clone.removeAttribute('data-alt-month');
    clone.removeAttribute('data-alt-sem-alt');
    clone.removeAttribute('data-alt-part2');
    clone.removeAttribute('data-alt-comportamento');
    return clone.outerHTML;
  };

  let inPart2 = false;
  let inPart2Footer = false;

  for (const entry of nodes) {
    if (entry.block) {
      if (entry.block.isSpacer) {
        if (entry.block.preserveIfSpacer || !lastIsSpacer()) {
          blocks.push(entry.block.preserveIfSpacer ? entry.block : spacer());
        }
        continue;
      }
      blocks.push(entry.block);
      continue;
    }

    const el = entry.el!;
    const hasCaret = elementContainsCaretMarker(el);

    if (isSpacerElement(el)) {
      if (hasCaret) {
        blocks.push({
          html: stripStaleAltAttrsFromSpacer(el),
          isSpacer: true,
          preserveIfSpacer: true,
        });
        continue;
      }
      // Preserve intentional blank lines typed by the user inside a page during live editing
      // (including signing space in 2ª Parte and blank lines used to push sections to the next sheet),
      // while avoiding duplicate spacers at old page break boundaries.
      if (preserveUserSpacers && (!entry.crossedPageBreak || !lastIsSpacer())) {
        blocks.push({ html: stripStaleAltAttrsFromSpacer(el), isSpacer: true });
        continue;
      }
      // Keep double signing space inside 2ª Parte footer even during checklist reflows
      if (inPart2Footer) {
        blocks.push({ html: stripStaleAltAttrsFromSpacer(el), isSpacer: true, preserveIfSpacer: true });
        continue;
      }
      if (!lastIsSpacer()) {
        blocks.push(spacer());
      }
      continue;
    }

    const rawTxt = (el.textContent || '').trim();
    const txtNorm = normalizeKey(rawTxt);
    if (el.hasAttribute('data-alt-part2') || /^2[Aª]?\s*PARTE\b/.test(txtNorm)) {
      inPart2 = true;
      inPart2Footer = false;
    } else if (inPart2 && !inPart2Footer && isPart2FooterElement(el)) {
      inPart2Footer = true;
    }

    // If a section/month/group heading crossed a previous page break where its spacer was stripped,
    // restore a single clean spacer before it when pulling it onto the previous page.
    if (entry.crossedPageBreak && needsLeadingSpacerBeforeEl(el) && !lastIsSpacer()) {
      blocks.push(spacer());
    }

    if (el.tagName.toUpperCase() === 'TABLE') {
      const tblBlock = extractTableMetaFromEl(el);
      const itemId = tblBlock.tableMeta?.itemId;
      if (itemId) {
        tblBlock.atomicGroupId = itemId;
        // Link the table's immediately preceding Subtitle (skipping at most 1 spacer) to the table
        let back = blocks.length - 1;
        let skippedSpacers = 0;
        while (back >= 0 && blocks[back].isSpacer && skippedSpacers < 1) {
          back--;
          skippedSpacers++;
        }
        if (
          back >= 0 &&
          blocks[back].keepWithNext &&
          blocks[back].html.includes(`data-alt-item="${itemId}"`)
        ) {
          blocks[back].atomicGroupId = itemId;
        }
      }
      const prev = blocks[blocks.length - 1];

      // Merge split chunks of the SAME table across an old page break so it re-splits cleanly
      if (
        itemId &&
        prev?.tableMeta &&
        prev.tableMeta.itemId === itemId &&
        tblBlock.tableMeta &&
        tblBlock.tableMeta.rowsHtml.length > 0
      ) {
        let incomingRows = tblBlock.tableMeta.rowsHtml;
        if (
          prev.tableMeta.headerRowHtml &&
          incomingRows.length > 0 &&
          normalizeKey(
            new DOMParser().parseFromString(`<table>${incomingRows[0]}</table>`, 'text/html').body
              .textContent || ''
          ) ===
            normalizeKey(
              new DOMParser().parseFromString(
                `<table>${prev.tableMeta.headerRowHtml}</table>`,
                'text/html'
              ).body.textContent || ''
            )
        ) {
          incomingRows = incomingRows.slice(1);
        }
        const mergedRows = [...prev.tableMeta.rowsHtml, ...incomingRows];
        prev.tableMeta = {
          ...prev.tableMeta,
          rowsHtml: mergedRows,
        };
        prev.html = buildAlteracaoTableHtml(mergedRows, itemId, prev.tableMeta.colgroupHtml);
        continue;
      }

      blocks.push(tblBlock);
      continue;
    }

    const keepWithNext = isHeadingKeepWithNext(el);
    const isComportamentoEl =
      !inPart2 && (el.hasAttribute('data-alt-comportamento') || isAnyComportamentoLine(rawTxt));

    // Comportamento stays independent from any BI above it; 2ª Parte lines and regular text BI
    // paragraphs deliberately have NO atomicGroupId so every line flows freely one at a time.
    const atomicGroupId = isComportamentoEl ? 'comportamento' : undefined;

    blocks.push({
      html: el.outerHTML,
      keepWithNext,
      atomicGroupId,
    });
  }

  return blocks;
}

function getGroupKey(month: string, title: string): string {
  return `${month}::${title.toUpperCase()}`;
}

function matchesGroupEl(el: HTMLElement, month: string, title: string, activeMonth: string | null): boolean {
  const attr = el.getAttribute('data-alt-group');
  if (attr) {
    return normalizeKey(attr) === normalizeKey(getGroupKey(month, title));
  }
  if (activeMonth && normalizeKey(activeMonth) !== normalizeKey(month)) return false;
  if (el.tagName.toUpperCase() === 'TABLE') return false;
  const strong = el.querySelector('strong, b');
  if (!strong) return false;
  return normalizeKey(el.textContent || '') === normalizeKey(title);
}

/**
 * Surgically removes or re-inserts checklist items inside the live edited pages HTML,
 * locking all content ABOVE the mutation point untouched and reflowing ONLY content BELOW.
 * - On delete: content below pulls UP into the freed space.
 * - On add: item returns to its exact original position and pushes content below DOWN.
 */
export function applyChecklistDeltaToLivePages(params: {
  livePagesHtml: string[];
  structuredDoc: StructuredAlteracaoDoc;
  prevEnabledIds: Set<string>;
  nextEnabledIds: Set<string>;
  paginateOptions: PaginateOptions;
}): string[] {
  const { livePagesHtml, structuredDoc, prevEnabledIds, nextEnabledIds, paginateOptions } = params;

  const removedIds = structuredDoc.items
    .filter((it) => prevEnabledIds.has(it.id) && !nextEnabledIds.has(it.id))
    .map((it) => it.id);

  const addedItems = structuredDoc.items.filter(
    (it) => !prevEnabledIds.has(it.id) && nextEnabledIds.has(it.id)
  );

  if (removedIds.length === 0 && addedItems.length === 0) {
    return livePagesHtml;
  }

  const pageElsList = livePagesHtml.map((html) => parsePageElements(html));
  const flat: FlatNode[] = [];
  pageElsList.forEach((els, pageIndex) => {
    els.forEach((el, elIndex) => {
      flat.push({
        pageIndex,
        elIndex,
        el,
        isNewPageBoundary: elIndex === 0 && pageIndex > 0,
      });
    });
  });

  // =========================================================================
  // CASE 1: REMOVAL — lock everything before the earliest removed element,
  // strip removed items (+ empty group titles, insert Sem Alteração if month emptied),
  // and pull content below UP!
  // =========================================================================
  if (removedIds.length > 0 && addedItems.length === 0) {
    const removedSet = new Set(removedIds);
    const removedItems = structuredDoc.items.filter((it) => removedSet.has(it.id));

    // Determine which groups and months become completely empty after removal
    const affectedGroups = new Set(
      removedItems.map((it) => normalizeKey(getGroupKey(it.month, it.title)))
    );
    const emptiedGroups = new Set<string>();
    for (const grpKey of affectedGroups) {
      const stillHasAny = structuredDoc.items.some(
        (it) =>
          nextEnabledIds.has(it.id) &&
          normalizeKey(getGroupKey(it.month, it.title)) === grpKey
      );
      if (!stillHasAny) emptiedGroups.add(grpKey);
    }

    const affectedMonths = new Set(removedItems.map((it) => it.month));
    const emptiedMonths = new Set<string>();
    for (const m of affectedMonths) {
      const stillHasAny = structuredDoc.items.some(
        (it) => nextEnabledIds.has(it.id) && it.month === m
      );
      if (!stillHasAny) emptiedMonths.add(m);
    }

    // Track active month while scanning flat nodes for fallback matching
    const removeIndices = new Set<number>();
    let currentScannedMonth: string | null = null;

    for (let i = 0; i < flat.length; i++) {
      const el = flat[i].el;
      const detectedMonth = getMonthHeadingName(el);
      if (detectedMonth) {
        currentScannedMonth = detectedMonth;
        continue;
      }

      const itemAttr = el.getAttribute('data-alt-item');
      if (itemAttr && removedSet.has(itemAttr)) {
        removeIndices.add(i);
        continue;
      }

      // Check emptied group headers
      const grpAttr = el.getAttribute('data-alt-group');
      if (grpAttr && emptiedGroups.has(normalizeKey(grpAttr))) {
        removeIndices.add(i);
        continue;
      }

      // Legacy fallback: match orphaned group header by text inside current month
      if (!grpAttr && currentScannedMonth) {
        const matchedEmptyGroup = removedItems.some(
          (it) =>
            emptiedGroups.has(normalizeKey(getGroupKey(it.month, it.title))) &&
            matchesGroupEl(el, it.month, it.title, currentScannedMonth)
        );
        if (matchedEmptyGroup) {
          removeIndices.add(i);
          continue;
        }
      }
    }

    // Legacy fallback: if a removed table had a subtitle `<p><strong>SUBTITLE</strong></p>` without data-alt-item
    // immediately preceding the first removed element of that item, remove that orphaned subtitle too.
    for (const item of removedItems) {
      if (!item.subtitle) continue;
      const sameSubStillEnabled = structuredDoc.items.some(
        (other) =>
          other.id !== item.id &&
          nextEnabledIds.has(other.id) &&
          other.month === item.month &&
          normalizeKey(other.title) === normalizeKey(item.title) &&
          normalizeKey(other.subtitle) === normalizeKey(item.subtitle)
      );
      if (sameSubStillEnabled) continue;

      const wantedSub = normalizeKey(item.subtitle);
      for (let i = 0; i < flat.length; i++) {
        if (!removeIndices.has(i)) continue;
        if (flat[i].el.getAttribute('data-alt-item') !== item.id) continue;
        // Look backward skipping at most 1 spacer
        let back = i - 1;
        while (back >= 0 && isSpacerElement(flat[back].el)) back--;
        if (back >= 0 && !removeIndices.has(back)) {
          const prevEl = flat[back].el;
          const prevTxt = normalizeKey(prevEl.textContent || '');
          if (prevTxt === wantedSub && prevEl.querySelector('strong, b')) {
            removeIndices.add(back);
          }
        }
        break;
      }
    }

    if (removeIndices.size === 0) {
      return livePagesHtml;
    }

    const firstRemovedFlatIdx = Math.min(...Array.from(removeIndices));
    const firstNode = flat[firstRemovedFlatIdx];
    const startPageIndex = firstNode.pageIndex;
    const splitElIndex = firstNode.elIndex;

    const untouchedPages = livePagesHtml.slice(0, startPageIndex);
    const lockedPrefixEls = pageElsList[startPageIndex].slice(0, splitElIndex);
    const lockedPrefixHtmls = lockedPrefixEls.map((el) => el.outerHTML);
    const prefixEndedWithSpacer =
      lockedPrefixEls.length > 0 && isSpacerElement(lockedPrefixEls[lockedPrefixEls.length - 1]);

    // Check which emptied months already had their heading before firstRemovedFlatIdx
    const semAltInserted = new Set<string>();
    const tailEntries: Array<{
      el?: HTMLElement;
      block?: AlteracaoHtmlBlock;
      crossedPageBreak?: boolean;
    }> = [];

    // Find which month is active right at firstRemovedFlatIdx (in case the heading is in lockedPrefixEls or earlier page)
    let activeMonthAtSplit: string | null = null;
    for (let i = 0; i < firstRemovedFlatIdx; i++) {
      const m = getMonthHeadingName(flat[i].el);
      if (m) activeMonthAtSplit = m;
    }

    if (activeMonthAtSplit && emptiedMonths.has(activeMonthAtSplit)) {
      if (!prefixEndedWithSpacer) {
        tailEntries.push({ block: { html: '<p><br></p>', isSpacer: true } });
      }
      tailEntries.push({
        block: {
          html: `<p data-alt-sem-alt="${escapeHtmlAttr(activeMonthAtSplit)}">- <u>Sem Alteração</u></p>`,
        },
      });
      semAltInserted.add(activeMonthAtSplit);
    }

    for (let i = firstRemovedFlatIdx; i < flat.length; i++) {
      if (removeIndices.has(i)) continue;
      const node = flat[i];
      const detectedMonth = getMonthHeadingName(node.el);

      tailEntries.push({
        el: node.el,
        crossedPageBreak: node.isNewPageBoundary,
      });

      if (detectedMonth && emptiedMonths.has(detectedMonth) && !semAltInserted.has(detectedMonth)) {
        tailEntries.push({ block: { html: '<p><br></p>', isSpacer: true } });
        tailEntries.push({
          block: {
            html: `<p data-alt-sem-alt="${escapeHtmlAttr(detectedMonth)}">- <u>Sem Alteração</u></p>`,
          },
        });
        semAltInserted.add(detectedMonth);
      }
    }

    const tailBlocks = elementsToReflowBlocks(tailEntries, prefixEndedWithSpacer);
    const reflowedPages = paginateAlteracaoBlocksInDom(tailBlocks, {
      ...paginateOptions,
      startOnContinuationPage: startPageIndex > 0,
      lockedPrefixHtmls,
    });

    return [...untouchedPages, ...reflowedPages];
  }

  // =========================================================================
  // CASE 2: RE-ADDITION — find exact original anchor in live DOM, lock
  // everything ABOVE the earliest anchor, insert blocks in canonical order,
  // and push content BELOW downward!
  // =========================================================================
  if (addedItems.length > 0) {
    // Group consecutive added items that belong to the same (month, title)
    const itemBatches: ParsedAlteracaoSectionItem[][] = [];
    for (const item of addedItems) {
      const lastBatch = itemBatches[itemBatches.length - 1];
      if (
        lastBatch &&
        lastBatch[0].month === item.month &&
        normalizeKey(lastBatch[0].title) === normalizeKey(item.title)
      ) {
        lastBatch.push(item);
      } else {
        itemBatches.push([item]);
      }
    }

    // Working stream of mixed existing FlatNodes and inserted blocks
    type StreamEntry = {
      originFlat?: FlatNode;
      el?: HTMLElement;
      block?: AlteracaoHtmlBlock;
      crossedPageBreak?: boolean;
      syntheticMonth?: string;
      syntheticGroupKey?: string;
      syntheticItemId?: string;
    };

    const stream: StreamEntry[] = flat.map((node) => ({
      originFlat: node,
      el: node.el,
      crossedPageBreak: node.isNewPageBoundary,
    }));

    let earliestMutationStreamIdx = stream.length;

    const getEntryMonth = (entry: StreamEntry): string | null => {
      if (entry.syntheticMonth) return entry.syntheticMonth;
      return entry.el ? getMonthHeadingName(entry.el) : null;
    };

    const getEntryGroupKey = (entry: StreamEntry): string | null => {
      if (entry.syntheticGroupKey) return entry.syntheticGroupKey;
      const attr = entry.el?.getAttribute('data-alt-group');
      return attr ? normalizeKey(attr) : null;
    };

    const getEntryItemId = (entry: StreamEntry): string | null => {
      if (entry.syntheticItemId) return entry.syntheticItemId;
      return entry.el?.getAttribute('data-alt-item') ?? null;
    };

    const findItemRangeInStream = (itemId: string): { first: number; last: number } | null => {
      let first = -1;
      let last = -1;
      for (let i = 0; i < stream.length; i++) {
        if (getEntryItemId(stream[i]) === itemId) {
          if (first === -1) first = i;
          last = i;
        }
      }
      return first === -1 ? null : { first, last };
    };

    const findGroupHeaderIndex = (month: string, title: string): number => {
      const wanted = normalizeKey(getGroupKey(month, title));
      let activeM: string | null = null;
      for (let i = 0; i < stream.length; i++) {
        const m = getEntryMonth(stream[i]);
        if (m) activeM = m;
        if (getEntryGroupKey(stream[i]) === wanted) return i;
        if (stream[i].el && matchesGroupEl(stream[i].el!, month, title, activeM)) {
          return i;
        }
      }
      return -1;
    };

    const findMonthHeadingIndex = (month: string): number => {
      const wanted = normalizeKey(month);
      for (let i = 0; i < stream.length; i++) {
        const m = getEntryMonth(stream[i]);
        if (m && normalizeKey(m) === wanted) return i;
      }
      return -1;
    };

    for (const batch of itemBatches) {
      const firstItem = batch[0];
      const month = firstItem.month;
      const groupTitle = firstItem.title;
      const groupKeyNorm = normalizeKey(getGroupKey(month, groupTitle));

      const allGroupItems = structuredDoc.items.filter(
        (it) =>
          it.month === month && normalizeKey(it.title) === normalizeKey(groupTitle)
      );
      const firstBatchIdxInGroup = allGroupItems.findIndex((it) => it.id === firstItem.id);
      const lastBatchIdxInGroup = allGroupItems.findIndex(
        (it) => it.id === batch[batch.length - 1].id
      );

      // Find previous & next already-present items in the same group
      let prevEnabledItemInGroup: ParsedAlteracaoSectionItem | null = null;
      for (let i = firstBatchIdxInGroup - 1; i >= 0; i--) {
        if (findItemRangeInStream(allGroupItems[i].id)) {
          prevEnabledItemInGroup = allGroupItems[i];
          break;
        }
      }

      let nextEnabledItemInGroup: ParsedAlteracaoSectionItem | null = null;
      for (let i = lastBatchIdxInGroup + 1; i < allGroupItems.length; i++) {
        if (findItemRangeInStream(allGroupItems[i].id)) {
          nextEnabledItemInGroup = allGroupItems[i];
          break;
        }
      }

      const existingGroupHeaderIdx = findGroupHeaderIndex(month, groupTitle);
      const includeGroupHeader = existingGroupHeaderIdx === -1;
      const isFirstItemInGroup = !prevEnabledItemInGroup;

      const renderedBlocks = renderItemBlocksForInsertion(batch, {
        includeGroupHeader,
        groupDisplayTitle: groupTitle,
        monthName: month,
        isFirstItemInGroup,
        prevSubtitleInGroup: prevEnabledItemInGroup?.subtitle,
      });

      const makeInsertedEntries = (blocks: AlteracaoHtmlBlock[]): StreamEntry[] =>
        blocks.map((blk) => {
          const isGrp = blk.html.includes('data-alt-group=');
          const itemIdMatch = blk.html.match(/data-alt-item="([^"]+)"/);
          return {
            block: blk,
            syntheticGroupKey: isGrp ? groupKeyNorm : undefined,
            syntheticItemId: itemIdMatch ? itemIdMatch[1] : undefined,
          };
        });

      let insertIdx = -1;
      let replaceCount = 0;
      const extraPrefixBlocks: AlteracaoHtmlBlock[] = [];
      const extraSuffixBlocks: AlteracaoHtmlBlock[] = [];

      if (!includeGroupHeader) {
        // Group already exists in live DOM
        if (nextEnabledItemInGroup) {
          const nextRange = findItemRangeInStream(nextEnabledItemInGroup.id)!;
          insertIdx = nextRange.first;
          extraSuffixBlocks.push({ html: '<p><br></p>', isSpacer: true });
        } else if (prevEnabledItemInGroup) {
          const prevRange = findItemRangeInStream(prevEnabledItemInGroup.id)!;
          insertIdx = prevRange.last + 1;
        } else {
          insertIdx = existingGroupHeaderIdx + 1;
        }
      } else {
        // Group header needs to be inserted inside its month
        const monthHeadingIdx = findMonthHeadingIndex(month);
        if (monthHeadingIdx !== -1) {
          // Check if month currently shows "- Sem Alteração"
          let semAltIdx = -1;
          for (let i = monthHeadingIdx + 1; i < stream.length; i++) {
            if (getEntryMonth(stream[i]) || stream[i].el?.hasAttribute('data-alt-part2')) break;
            if (stream[i].el && isSemAlteracaoEl(stream[i].el!)) {
              semAltIdx = i;
              break;
            }
          }

          if (semAltIdx !== -1) {
            insertIdx = semAltIdx;
            replaceCount = 1;
          } else {
            // Find exact group position within the month
            const allMonthItems = structuredDoc.items.filter((it) => it.month === month);
            const firstIdxInMonth = allMonthItems.findIndex((it) => it.id === firstItem.id);
            const lastIdxInMonth = allMonthItems.findIndex(
              (it) => it.id === batch[batch.length - 1].id
            );

            // Look for next existing group in the same month
            let nextGroupIdxInStream = -1;
            for (let i = lastIdxInMonth + 1; i < allMonthItems.length; i++) {
              const cand = allMonthItems[i];
              const gIdx = findGroupHeaderIndex(month, cand.title);
              if (gIdx !== -1) {
                nextGroupIdxInStream = gIdx;
                break;
              }
              const r = findItemRangeInStream(cand.id);
              if (r) {
                nextGroupIdxInStream = r.first;
                break;
              }
            }

            if (nextGroupIdxInStream !== -1) {
              insertIdx = nextGroupIdxInStream;
              extraPrefixBlocks.push({ html: '<p><br></p>', isSpacer: true });
              extraSuffixBlocks.push({ html: '<p><br></p>', isSpacer: true });
            } else {
              // Look for last existing item in the same month before us
              let prevEndInMonth = -1;
              for (let i = firstIdxInMonth - 1; i >= 0; i--) {
                const r = findItemRangeInStream(allMonthItems[i].id);
                if (r) {
                  prevEndInMonth = r.last;
                  break;
                }
              }
              if (prevEndInMonth !== -1) {
                insertIdx = prevEndInMonth + 1;
                extraPrefixBlocks.push({ html: '<p><br></p>', isSpacer: true });
              } else {
                // Insert right after month heading (skipping 1 spacer if already present)
                insertIdx = monthHeadingIdx + 1;
                if (
                  insertIdx < stream.length &&
                  stream[insertIdx].el &&
                  isSpacerElement(stream[insertIdx].el!)
                ) {
                  insertIdx++;
                } else {
                  extraPrefixBlocks.push({ html: '<p><br></p>', isSpacer: true });
                }
              }
            }
          }
        } else {
          // Month heading itself wasn't in DOM — insert month heading + group before next month or Part 2
          const mPos = structuredDoc.monthOrder.indexOf(month);
          let targetIdx = stream.length;
          if (mPos !== -1) {
            for (let m = mPos + 1; m < structuredDoc.monthOrder.length; m++) {
              const nextMIdx = findMonthHeadingIndex(structuredDoc.monthOrder[m]);
              if (nextMIdx !== -1) {
                targetIdx = nextMIdx;
                break;
              }
            }
          }
          if (targetIdx === stream.length) {
            const part2Idx = stream.findIndex((s) => s.el?.hasAttribute('data-alt-part2'));
            if (part2Idx !== -1) targetIdx = part2Idx;
          }
          insertIdx = targetIdx;
          extraPrefixBlocks.push(
            { html: '<p><br></p>', isSpacer: true },
            {
              html: `<p data-alt-month="${escapeHtmlAttr(month)}">${escapeHtmlAttr(month)}:</p>`,
              keepWithNext: true,
            },
            { html: '<p><br></p>', isSpacer: true }
          );
          extraSuffixBlocks.push({ html: '<p><br></p>', isSpacer: true });
        }
      }

      if (insertIdx < 0) insertIdx = stream.length;

      const entriesToSplice: StreamEntry[] = [
        ...extraPrefixBlocks.map((b) => ({
          block: b,
          syntheticMonth: b.html.includes('data-alt-month=') ? month : undefined,
        })),
        ...makeInsertedEntries(renderedBlocks),
        ...extraSuffixBlocks.map((b) => ({ block: b })),
      ];

      stream.splice(insertIdx, replaceCount, ...entriesToSplice);
      if (insertIdx < earliestMutationStreamIdx) {
        earliestMutationStreamIdx = insertIdx;
      }
    }

    // Determine the exact page & element index to lock above earliestMutationStreamIdx.
    // Preferring the preceding originFlat ensures items re-inserted right after an element
    // at the bottom of page P return to their exact spot on page P when space permits,
    // without disturbing any element before them.
    let startPageIndex = 0;
    let splitElIndex = 0;

    let prevOrigin: FlatNode | undefined;
    for (let i = earliestMutationStreamIdx - 1; i >= 0; i--) {
      if (stream[i].originFlat) {
        prevOrigin = stream[i].originFlat;
        break;
      }
    }

    if (prevOrigin) {
      startPageIndex = prevOrigin.pageIndex;
      splitElIndex = prevOrigin.elIndex + 1;
    } else {
      let nextOrigin: FlatNode | undefined;
      for (let i = earliestMutationStreamIdx; i < stream.length; i++) {
        if (stream[i].originFlat) {
          nextOrigin = stream[i].originFlat;
          break;
        }
      }
      if (nextOrigin) {
        startPageIndex = nextOrigin.pageIndex;
        splitElIndex = nextOrigin.elIndex;
      }
    }

    const untouchedPages = livePagesHtml.slice(0, startPageIndex);
    const lockedPrefixEls = pageElsList[startPageIndex].slice(0, splitElIndex);
    const lockedPrefixHtmls = lockedPrefixEls.map((el) => el.outerHTML);
    const prefixEndedWithSpacer =
      lockedPrefixEls.length > 0 && isSpacerElement(lockedPrefixEls[lockedPrefixEls.length - 1]);

    // Slice stream starting exactly from the first entry belonging to (startPageIndex, splitElIndex) or later
    const tailStreamStart = earliestMutationStreamIdx;
    const tailBlocks = elementsToReflowBlocks(
      stream.slice(tailStreamStart).map((s) => ({
        el: s.el,
        block: s.block,
        crossedPageBreak: s.crossedPageBreak,
      })),
      prefixEndedWithSpacer
    );

    const reflowedPages = paginateAlteracaoBlocksInDom(tailBlocks, {
      ...paginateOptions,
      startOnContinuationPage: startPageIndex > 0,
      lockedPrefixHtmls,
    });

    return [...untouchedPages, ...reflowedPages];
  }

  return livePagesHtml;
}

interface PageBreakSignature {
  nonSpacerCount: number;
  tableRowCount: number;
  firstKey: string;
  lastKey: string;
}

function getPageBreakSignature(html: string): PageBreakSignature {
  const els = parsePageElements(html);
  const nonSpacers = els.filter((el) => !isSpacerElement(el));
  let tableRowCount = 0;
  for (const el of nonSpacers) {
    if (el.tagName.toUpperCase() === 'TABLE') {
      tableRowCount += el.querySelectorAll('tr').length;
    }
  }
  const makeKey = (el?: HTMLElement): string => {
    if (!el) return '';
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return `${el.tagName}:${txt.slice(0, 48)}:${txt.slice(-32)}`;
  };
  return {
    nonSpacerCount: nonSpacers.length,
    tableRowCount,
    firstKey: makeKey(nonSpacers[0]),
    lastKey: makeKey(nonSpacers[nonSpacers.length - 1]),
  };
}

function didPageBreaksChange(beforePages: string[], afterPages: string[]): boolean {
  if (beforePages.length !== afterPages.length) return true;
  for (let i = 0; i < beforePages.length; i++) {
    const a = getPageBreakSignature(beforePages[i]);
    const b = getPageBreakSignature(afterPages[i]);
    if (
      a.nonSpacerCount !== b.nonSpacerCount ||
      a.tableRowCount !== b.tableRowCount ||
      a.firstKey !== b.firstKey ||
      a.lastKey !== b.lastKey
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Temporarily injects an invisible caret marker into the active editor, reads its HTML,
 * and immediately removes the marker so the live DOM remains untouched if unused.
 */
export function captureEditorHtmlWithCaretMarker(editorEl: HTMLDivElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const origRange = selection.getRangeAt(0);
  if (!editorEl.contains(origRange.startContainer)) return null;

  const savedStartContainer = origRange.startContainer;
  const savedStartOffset = origRange.startOffset;
  const savedEndContainer = origRange.endContainer;
  const savedEndOffset = origRange.endOffset;

  const marker = document.createElement('span');
  marker.setAttribute(CARET_MARKER_ATTR, '1');

  const insertRange = origRange.cloneRange();
  insertRange.collapse(true);

  let html: string | null = null;
  try {
    insertRange.insertNode(marker);
    html = editorEl.innerHTML;
  } catch {
    html = null;
  } finally {
    if (marker.parentNode) {
      const parent = marker.parentNode;
      parent.removeChild(marker);
      try {
        // Rejoin split text nodes if marker split a text node
        parent.normalize();
      } catch {
        // ignore
      }
    }
    try {
      const restored = document.createRange();
      restored.setStart(savedStartContainer, savedStartOffset);
      restored.setEnd(savedEndContainer, savedEndOffset);
      selection.removeAllRanges();
      selection.addRange(restored);
    } catch {
      // ignore if DOM changed
    }
  }

  return html;
}

function extractCaretBookmarkAndCleanHtml(pagesHtml: string[]): {
  pagesHtml: string[];
  caret: LiveCaretBookmark | null;
} {
  let caret: LiveCaretBookmark | null = null;
  const cleaned = pagesHtml.map((html, pageIndex) => {
    if (!html.includes(CARET_MARKER_ATTR)) return html;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const marker = doc.body.querySelector(`[${CARET_MARKER_ATTR}]`);
    if (!marker) return html;

    // Find top-level child of doc.body containing marker
    let topNode: Node | null = marker;
    while (topNode && topNode.parentNode && topNode.parentNode !== doc.body) {
      topNode = topNode.parentNode;
    }

    const topChildren = Array.from(doc.body.children);
    const blockIndex =
      topNode && topNode.nodeType === Node.ELEMENT_NODE
        ? Math.max(0, topChildren.indexOf(topNode as HTMLElement))
        : 0;

    const scopeEl = (topChildren[blockIndex] as HTMLElement | undefined) ?? doc.body;
    let textOffset = 0;
    const walker = doc.createTreeWalker(
      scopeEl,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );
    let cur: Node | null;
    while ((cur = walker.nextNode())) {
      if (cur === marker) break;
      if (cur.nodeType === Node.TEXT_NODE) {
        textOffset += (cur.textContent || '').length;
      }
    }

    marker.parentNode?.removeChild(marker);
    const isEmptyBlock =
      (scopeEl.textContent || '').replace(/\u00a0/g, '').trim().length === 0;

    caret = {
      pageIndex,
      blockIndex,
      textOffset,
      isEmptyBlock,
    };

    const nextHtml = doc.body.innerHTML.trim();
    return nextHtml || '<p><br></p>';
  });

  return { pagesHtml: cleaned, caret };
}

/**
 * Restores the user's cursor to the exact character offset (even if the block moved to
 * another page during linked-page reflow) and smoothly scrolls it into view if needed.
 */
export function restoreCaretBookmarkInEditors(
  editors: (HTMLDivElement | null)[],
  bookmark: LiveCaretBookmark
): void {
  const editor = editors[bookmark.pageIndex] ?? editors[editors.length - 1];
  if (!editor) return;

  try {
    editor.focus({ preventScroll: true });
  } catch {
    editor.focus();
  }

  const children = Array.from(editor.children) as HTMLElement[];
  const targetBlock =
    children[Math.min(bookmark.blockIndex, Math.max(0, children.length - 1))] ?? editor;

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();

  if (bookmark.isEmptyBlock) {
    range.setStart(targetBlock, 0);
    range.collapse(true);
  } else {
    let remaining = bookmark.textOffset;
    let placed = false;
    const walker = document.createTreeWalker(targetBlock, NodeFilter.SHOW_TEXT);
    let lastTextNode: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      lastTextNode = textNode;
      const len = textNode.data.length;
      if (remaining <= len) {
        range.setStart(textNode, remaining);
        range.collapse(true);
        placed = true;
        break;
      }
      remaining -= len;
    }
    if (!placed) {
      if (lastTextNode) {
        range.setStart(lastTextNode, lastTextNode.data.length);
        range.collapse(true);
      } else {
        range.selectNodeContents(targetBlock);
        range.collapse(false);
      }
    }
  }

  selection.removeAllRanges();
  selection.addRange(range);

  // Only scroll if the target block is outside the visible viewport
  try {
    const rect = targetBlock.getBoundingClientRect();
    if (rect.top < 72 || rect.bottom > window.innerHeight - 24) {
      targetBlock.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    }
  } catch {
    // ignore scroll errors
  }
}

function runLinkedPagination(
  pagesHtml: string[],
  paginateOptions: PaginateOptions
): string[] {
  const pageElsList = pagesHtml.map((html) => parsePageElements(html));
  const flatEntries: Array<{ el: HTMLElement; crossedPageBreak: boolean }> = [];

  pageElsList.forEach((els, pageIndex) => {
    els.forEach((el, elIndex) => {
      flatEntries.push({
        el,
        crossedPageBreak: elIndex === 0 && pageIndex > 0,
      });
    });
  });

  const blocks = elementsToReflowBlocks(flatEntries, false, {
    preserveUserSpacers: true,
  });

  return paginateAlteracaoBlocksInDom(blocks, {
    ...paginateOptions,
    startOnContinuationPage: false,
    lockedPrefixHtmls: [],
    preserveTrailingSpacers: true,
  });
}

/**
 * Reflows all linked A4 sheets continuously as one connected document while:
 * - Pulling content UP automatically when text/blocks are deleted above,
 * - Pushing overflowing content DOWN onto subsequent sheets (creating new sheets as needed),
 * - Never cutting an atomic subject, paragraph, or single-page table in half,
 * - Returning `changed: false` with zero DOM churn when no page break actually moved,
 * - Preserving the exact caret position across page boundaries when breaks do move.
 */
export function reflowLiveEditedPages(params: {
  livePagesHtml: string[];
  paginateOptions: PaginateOptions;
  activePageIndex?: number;
  captureActiveMarkerHtml?: () => string | null;
  hasDomOverflow?: boolean;
  forceApply?: boolean;
}): LiveReflowResult {
  const {
    livePagesHtml,
    paginateOptions,
    activePageIndex = 0,
    captureActiveMarkerHtml,
    hasDomOverflow = false,
    forceApply = false,
  } = params;

  if (livePagesHtml.length === 0) {
    return { changed: false, pagesHtml: ['<p><br></p>'], caret: null };
  }

  // Phase 1: fast pure off-screen check without touching live DOM selection
  const probeReflowed = runLinkedPagination(livePagesHtml, paginateOptions);
  const breaksChanged = didPageBreaksChange(livePagesHtml, probeReflowed);

  if (!breaksChanged && !hasDomOverflow && !forceApply) {
    return { changed: false, pagesHtml: livePagesHtml, caret: null };
  }

  // Phase 2: page boundary moved (or active page overflows on a trailing blank line) ->
  // capture live caret marker and reflow once with marker
  const markedHtml = captureActiveMarkerHtml ? captureActiveMarkerHtml() : null;
  if (!markedHtml) {
    if (!breaksChanged && !forceApply) {
      return { changed: false, pagesHtml: livePagesHtml, caret: null };
    }
    return { changed: true, pagesHtml: probeReflowed, caret: null };
  }

  const markedPages = [...livePagesHtml];
  if (activePageIndex >= 0 && activePageIndex < markedPages.length) {
    markedPages[activePageIndex] = markedHtml;
  }

  const reflowedWithMarker = runLinkedPagination(markedPages, paginateOptions);
  const { pagesHtml: cleanPages, caret } = extractCaretBookmarkAndCleanHtml(reflowedWithMarker);

  const markedBreaksChanged =
    breaksChanged ||
    didPageBreaksChange(livePagesHtml, cleanPages) ||
    cleanPages.length !== livePagesHtml.length ||
    (caret !== null && caret.pageIndex !== activePageIndex);

  if (!markedBreaksChanged && !forceApply) {
    return { changed: false, pagesHtml: livePagesHtml, caret: null };
  }

  return {
    changed: true,
    pagesHtml: cleanPages,
    caret,
  };
}

function isSelectionAtStartOfEditor(editorEl: HTMLDivElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.startContainer)) return false;

  const pre = document.createRange();
  pre.selectNodeContents(editorEl);
  pre.setEnd(range.startContainer, range.startOffset);
  if (pre.toString().length > 0) return false;

  // Ensure there is no preceding non-empty block or table before the caret
  const frag = pre.cloneContents();
  if (frag.querySelector('table')) return false;
  const blockEls = Array.from(frag.querySelectorAll('p, div, li'));
  // If cursor is in the 2nd+ empty line at top of page, let native Backspace delete the empty line first
  if (blockEls.length > 1) return false;
  return true;
}

function isSelectionAtEndOfEditor(editorEl: HTMLDivElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.endContainer)) return false;

  const post = document.createRange();
  post.selectNodeContents(editorEl);
  post.setStart(range.endContainer, range.endOffset);
  if (post.toString().length > 0) return false;

  const frag = post.cloneContents();
  if (frag.querySelector('table')) return false;
  const blockEls = Array.from(frag.querySelectorAll('p, div, li'));
  if (blockEls.length > 1) return false;
  return true;
}

/**
 * Handles Backspace at the very start of Page P (P > 0) and Delete at the very end of Page P (P < N - 1)
 * so adjacent sheets behave as one continuous linked document.
 */
export function tryHandleLinkedBoundaryKey(params: {
  key: 'Backspace' | 'Delete';
  pageIndex: number;
  editors: (HTMLDivElement | null)[];
  livePagesHtml: string[];
  paginateOptions: PaginateOptions;
}): { handled: false } | { handled: true; pagesHtml: string[]; caret: LiveCaretBookmark | null } {
  const { key, pageIndex, editors, livePagesHtml, paginateOptions } = params;
  const editorEl = editors[pageIndex];
  if (!editorEl) return { handled: false };

  if (key === 'Backspace') {
    if (pageIndex <= 0 || !isSelectionAtStartOfEditor(editorEl)) {
      return { handled: false };
    }
    const prevEls = parsePageElements(livePagesHtml[pageIndex - 1]);
    const currEls = parsePageElements(livePagesHtml[pageIndex]);
    if (prevEls.length === 0 || currEls.length === 0) return { handled: false };

    const prevLast = prevEls[prevEls.length - 1];
    const currFirst = currEls[0];

    const markerHtml = `<span ${CARET_MARKER_ATTR}="1"></span>`;
    const nextPages = [...livePagesHtml];

    if (isSpacerElement(prevLast)) {
      // Remove trailing blank line on previous page and keep cursor at start of currFirst
      prevEls.pop();
      currFirst.insertAdjacentHTML('afterbegin', markerHtml);
      nextPages[pageIndex - 1] = prevEls.map((e) => e.outerHTML).join('\n') || '<p><br></p>';
      nextPages[pageIndex] = currEls.map((e) => e.outerHTML).join('\n');
    } else if (isSpacerElement(currFirst)) {
      // Current first line is empty: remove it and place caret at end of previous page's last block
      currEls.shift();
      prevLast.insertAdjacentHTML('beforeend', markerHtml);
      nextPages[pageIndex - 1] = prevEls.map((e) => e.outerHTML).join('\n');
      nextPages[pageIndex] = currEls.map((e) => e.outerHTML).join('\n');
    } else if (
      prevLast.tagName.toUpperCase() !== 'TABLE' &&
      currFirst.tagName.toUpperCase() !== 'TABLE'
    ) {
      // Merge currFirst into prevLast with caret right at the join point
      prevLast.insertAdjacentHTML('beforeend', markerHtml);
      while (currFirst.firstChild) {
        prevLast.appendChild(currFirst.firstChild);
      }
      currEls.shift();
      nextPages[pageIndex - 1] = prevEls.map((e) => e.outerHTML).join('\n');
      nextPages[pageIndex] = currEls.map((e) => e.outerHTML).join('\n');
    } else {
      // Adjacent table: jump cursor smoothly to the end of previous page without corrupting table
      return {
        handled: true,
        pagesHtml: livePagesHtml,
        caret: {
          pageIndex: pageIndex - 1,
          blockIndex: Math.max(0, prevEls.length - 1),
          textOffset: (prevLast.textContent || '').length,
          isEmptyBlock: isSpacerElement(prevLast),
        },
      };
    }

    const reflowed = runLinkedPagination(nextPages, paginateOptions);
    const { pagesHtml, caret } = extractCaretBookmarkAndCleanHtml(reflowed);
    return { handled: true, pagesHtml, caret };
  }

  // key === 'Delete'
  if (pageIndex >= livePagesHtml.length - 1 || !isSelectionAtEndOfEditor(editorEl)) {
    return { handled: false };
  }

  const currEls = parsePageElements(livePagesHtml[pageIndex]);
  const nextEls = parsePageElements(livePagesHtml[pageIndex + 1]);
  if (currEls.length === 0 || nextEls.length === 0) return { handled: false };

  const currLast = currEls[currEls.length - 1];
  const nextFirst = nextEls[0];
  const markerHtml = `<span ${CARET_MARKER_ATTR}="1"></span>`;
  const nextPages = [...livePagesHtml];

  if (isSpacerElement(nextFirst)) {
    nextEls.shift();
    currLast.insertAdjacentHTML('beforeend', markerHtml);
    nextPages[pageIndex] = currEls.map((e) => e.outerHTML).join('\n');
    nextPages[pageIndex + 1] = nextEls.map((e) => e.outerHTML).join('\n');
  } else if (
    currLast.tagName.toUpperCase() !== 'TABLE' &&
    nextFirst.tagName.toUpperCase() !== 'TABLE'
  ) {
    currLast.insertAdjacentHTML('beforeend', markerHtml);
    while (nextFirst.firstChild) {
      currLast.appendChild(nextFirst.firstChild);
    }
    nextEls.shift();
    nextPages[pageIndex] = currEls.map((e) => e.outerHTML).join('\n');
    nextPages[pageIndex + 1] = nextEls.map((e) => e.outerHTML).join('\n');
  } else {
    return { handled: false };
  }

  const reflowed = runLinkedPagination(nextPages, paginateOptions);
  const { pagesHtml, caret } = extractCaretBookmarkAndCleanHtml(reflowed);
  return { handled: true, pagesHtml, caret };
}

function escapeHtmlTextLocal(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function isPart2HeadingText(text: string): boolean {
  const clean = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return /^2\s*[ª°oA]?\s*PARTE\b/i.test(clean);
}

function setElementTextPreservingSingleInlineWrapper(el: HTMLElement, nextText: string) {
  const trimmedChildren = Array.from(el.childNodes).filter(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE ||
      (n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 0)
  );
  if (
    trimmedChildren.length === 1 &&
    trimmedChildren[0].nodeType === Node.ELEMENT_NODE &&
    /^(STRONG|B|SPAN|EM|I|U)$/i.test((trimmedChildren[0] as HTMLElement).tagName)
  ) {
    (trimmedChildren[0] as HTMLElement).textContent = nextText;
    return;
  }
  el.textContent = nextText;
}

function buildPart2HtmlBlocksFromLines(lines: string[]): AlteracaoHtmlBlock[] {
  const blocks: AlteracaoHtmlBlock[] = [];
  let inCenteredFooter = false;
  let insertedFooterSpacer = false;

  lines.forEach((line, idx) => {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (idx === 0 && isPart2HeadingText(clean)) {
      blocks.push({
        html: '<p data-alt-part2="1" style="text-align:center;"><strong>2ª PARTE</strong></p>',
        keepWithNext: true,
        atomicGroupId: 'part2-item-1',
      });
      return;
    }

    if (!inCenteredFooter && isPart2CenteredFooterTrigger(clean)) {
      inCenteredFooter = true;
    }

    if (inCenteredFooter) {
      if (!insertedFooterSpacer) {
        blocks.push({
          html: '<p data-alt-part2="1"><br></p>',
          isSpacer: true,
          preserveIfSpacer: true,
          atomicGroupId: 'part2-signature',
        });
        insertedFooterSpacer = true;
      }
      if (/^[_\-–—]{5,}$/.test(clean)) {
        blocks.push({
          html: '<p data-alt-part2="1"><br></p>',
          isSpacer: true,
          preserveIfSpacer: true,
          atomicGroupId: 'part2-signature',
        });
      }
      blocks.push({
        html: `<p data-alt-part2="1" style="text-align:center;">${escapeHtmlTextLocal(clean)}</p>`,
        atomicGroupId: 'part2-signature',
      });
      return;
    }

    const isItem1Cluster = /^(?:1\.|a\.|b\.)\s*/i.test(clean);
    blocks.push({
      html: `<p data-alt-part2="1" style="text-align:left;">${escapeHtmlTextLocal(clean)}</p>`,
      atomicGroupId: isItem1Cluster ? 'part2-item-1' : undefined,
    });
  });

  return blocks;
}

export interface SurgicalPart2UpdateParams {
  livePagesHtml: string[];
  /** Formatted service time string (e.g. "08 a 04 m 12 d"). Leave empty to keep existing time values untouched. */
  serviceTimeFormatted?: string;
  /** Formatted Portuguese long date (e.g. "30 de junho de 2026"). Leave empty to keep existing closing date untouched. */
  closingDatePtBr?: string;
  /** Optional guarnição used only when appending a brand-new 2ª PARTE. */
  guarnicao?: string;
  /** Optional pagination options used only when appending a brand-new 2ª PARTE so overflow flows cleanly. */
  paginateOptions?: PaginateOptions;
}

export interface SurgicalPart2UpdateResult {
  pagesHtml: string[];
  part2PageIndex: number;
  foundExistingPart2: boolean;
  changed: boolean;
}

/**
 * Isolated surgical updater for 2ª PARTE (service time rows & closing date line).
 * NEVER rebuilds the document from structuredDoc and NEVER touches 1ª PARTE or any manual edits above 2ª PARTE.
 */
export function applyPart2UpdatesSurgicallyToPages(
  params: SurgicalPart2UpdateParams
): SurgicalPart2UpdateResult {
  const { livePagesHtml, serviceTimeFormatted, closingDatePtBr, guarnicao, paginateOptions } =
    params;
  const safePages = livePagesHtml.length > 0 ? livePagesHtml : ['<p><br></p>'];
  const hasTimeUpdate = Boolean(serviceTimeFormatted && serviceTimeFormatted.trim());
  const hasDateUpdate = Boolean(closingDatePtBr && closingDatePtBr.trim());

  if (!hasTimeUpdate && !hasDateUpdate) {
    return {
      pagesHtml: safePages,
      part2PageIndex: -1,
      foundExistingPart2: false,
      changed: false,
    };
  }

  // Locate where 2ª PARTE starts across pages
  let startPageIdx = -1;
  let startElIdx = -1;
  const parsedFromStart = new Map<number, HTMLElement[]>();

  for (let p = 0; p < safePages.length; p++) {
    const els = parsePageElements(safePages[p]);
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const txt = (el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (el.hasAttribute('data-alt-part2') || isPart2HeadingText(txt)) {
        startPageIdx = p;
        startElIdx = i;
        parsedFromStart.set(p, els);
        break;
      }
    }
    if (startPageIdx !== -1) break;
  }

  // Case A: Existing 2ª PARTE found -> update ONLY matching lines inside 2ª PARTE in place
  if (startPageIdx !== -1) {
    for (let p = startPageIdx + 1; p < safePages.length; p++) {
      parsedFromStart.set(p, parsePageElements(safePages[p]));
    }

    let hasItem3 = false;
    let hasItem5 = false;
    let updatedAny = false;
    let item4Location: { pageIdx: number; elIdx: number } | null = null;
    let footerLocation: { pageIdx: number; elIdx: number } | null = null;

    for (let p = startPageIdx; p < safePages.length; p++) {
      const els = parsedFromStart.get(p) || [];
      const fromIdx = p === startPageIdx ? startElIdx : 0;

      for (let i = fromIdx; i < els.length; i++) {
        const el = els[i];
        const tag = el.tagName.toUpperCase();

        // Handle legacy table-based 2ª PARTE rows if present
        if (tag === 'TABLE') {
          const rows = Array.from(el.querySelectorAll('tr'));
          for (const tr of rows) {
            const cells = Array.from(tr.querySelectorAll('td, th')) as HTMLElement[];
            if (cells.length === 0) continue;
            const joined = cells
              .map((c) => (c.textContent || '').replace(/\u00a0/g, ' ').trim())
              .filter(Boolean)
              .join(' ');
            if (hasDateUpdate && closingDatePtBr && isPart2ClosingDateLine(joined)) {
              const targetCell = cells.find((c) =>
                isPart2ClosingDateLine(c.textContent || '')
              );
              if (targetCell) {
                const updatedDateText = replaceDateInPart2ClosingLine(
                  targetCell.textContent || '',
                  closingDatePtBr
                );
                setElementTextPreservingSingleInlineWrapper(targetCell, updatedDateText);
                updatedAny = true;
              }
              continue;
            }
            if (!hasTimeUpdate || !serviceTimeFormatted) continue;
            const m = joined.match(PART2_ITEM_WITH_TIME_RE);
            if (!m) continue;
            const prefix = m[1];
            const lastCell = cells[cells.length - 1];
            if (prefix === '1.' || prefix.toLowerCase() === 'a.') {
              if (cells.length >= 2) {
                setElementTextPreservingSingleInlineWrapper(lastCell, '00 a 06 m 00 d');
              } else {
                const label = `${prefix} ${m[2].replace(/[.\s]+$/, '')}`;
                setElementTextPreservingSingleInlineWrapper(
                  lastCell,
                  formatPart2DotRow(label, '00 a 06 m 00 d')
                );
              }
              updatedAny = true;
            } else if (prefix === '3.' || prefix === '5.') {
              if (prefix === '3.') hasItem3 = true;
              if (prefix === '5.') hasItem5 = true;
              if (cells.length >= 2) {
                setElementTextPreservingSingleInlineWrapper(lastCell, serviceTimeFormatted);
              } else {
                const label = `${prefix} ${m[2].replace(/[.\s]+$/, '')}`;
                setElementTextPreservingSingleInlineWrapper(
                  lastCell,
                  formatPart2DotRow(label, serviceTimeFormatted)
                );
              }
              updatedAny = true;
            }
          }
          continue;
        }

        const clean = (el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        if (!clean) continue;

        if (!item4Location && /^4\./.test(clean)) {
          item4Location = { pageIdx: p, elIdx: i };
        }
        if (!footerLocation && isPart2CenteredFooterTrigger(clean)) {
          footerLocation = { pageIdx: p, elIdx: i };
        }

        if (hasDateUpdate && closingDatePtBr && isPart2ClosingDateLine(clean)) {
          const nextLine = replaceDateInPart2ClosingLine(clean, closingDatePtBr);
          if (nextLine !== clean) {
            setElementTextPreservingSingleInlineWrapper(el, nextLine);
            updatedAny = true;
          }
          continue;
        }

        if (!hasTimeUpdate || !serviceTimeFormatted) continue;

        const mWithTime = clean.match(PART2_ITEM_WITH_TIME_RE);
        const mLabelOnly = !mWithTime ? clean.match(PART2_ITEM_LABEL_ONLY_RE) : null;
        const match = mWithTime || mLabelOnly;
        if (!match) continue;

        const prefix = match[1];
        const rawLabel = match[2].replace(/[.\s]+$/, '');
        const label = `${prefix} ${rawLabel}`;

        if (prefix === '1.' || prefix.toLowerCase() === 'a.') {
          const nextRow = formatPart2DotRow(label, '00 a 06 m 00 d');
          if (nextRow !== clean) {
            setElementTextPreservingSingleInlineWrapper(el, nextRow);
            updatedAny = true;
          }
        } else if (prefix === '3.') {
          hasItem3 = true;
          const nextRow = formatPart2DotRow(label, serviceTimeFormatted);
          if (nextRow !== clean) {
            setElementTextPreservingSingleInlineWrapper(el, nextRow);
            updatedAny = true;
          }
        } else if (prefix === '5.') {
          hasItem5 = true;
          const nextRow = formatPart2DotRow(label, serviceTimeFormatted);
          if (nextRow !== clean) {
            setElementTextPreservingSingleInlineWrapper(el, nextRow);
            updatedAny = true;
          }
        }
      }
    }

    // Insert item 3 or item 5 ONLY if completely missing inside an existing 2ª PARTE
    if (hasTimeUpdate && serviceTimeFormatted && !hasItem3) {
      const targetPage = item4Location?.pageIdx ?? footerLocation?.pageIdx ?? safePages.length - 1;
      const targetEls = parsedFromStart.get(targetPage) || [];
      const rowEl = document.createElement('p');
      rowEl.setAttribute('data-alt-part2', '1');
      rowEl.style.textAlign = 'left';
      rowEl.textContent = formatPart2DotRow(
        '3. TEMPO DE SERVIÇO COMPUTÁVEL PARA MEDALHA MILITAR',
        serviceTimeFormatted
      );
      if (item4Location && item4Location.pageIdx === targetPage) {
        targetEls.splice(item4Location.elIdx, 0, rowEl);
        if (footerLocation && footerLocation.pageIdx === targetPage && footerLocation.elIdx >= item4Location.elIdx) {
          footerLocation.elIdx += 1;
        }
      } else if (footerLocation && footerLocation.pageIdx === targetPage) {
        targetEls.splice(footerLocation.elIdx, 0, rowEl);
        footerLocation.elIdx += 1;
      } else {
        targetEls.push(rowEl);
      }
      parsedFromStart.set(targetPage, targetEls);
      updatedAny = true;
    }

    if (hasTimeUpdate && serviceTimeFormatted && !hasItem5) {
      const targetPage = footerLocation?.pageIdx ?? safePages.length - 1;
      const targetEls = parsedFromStart.get(targetPage) || [];
      const rowEl = document.createElement('p');
      rowEl.setAttribute('data-alt-part2', '1');
      rowEl.style.textAlign = 'left';
      rowEl.textContent = formatPart2DotRow(
        '5. TEMPO TOTAL DE EFETIVO SERVIÇO (TTES)',
        serviceTimeFormatted
      );
      if (footerLocation && footerLocation.pageIdx === targetPage) {
        targetEls.splice(footerLocation.elIdx, 0, rowEl);
      } else {
        targetEls.push(rowEl);
      }
      parsedFromStart.set(targetPage, targetEls);
      updatedAny = true;
    }

    // Pages strictly before startPageIdx are returned VERBATIM untouched!
    const nextPages = safePages.map((origHtml, pIdx) => {
      if (pIdx < startPageIdx) return origHtml;
      const els = parsedFromStart.get(pIdx);
      if (!els) return origHtml;
      return els.map((e) => e.outerHTML).join('\n') || '<p><br></p>';
    });

    return {
      pagesHtml: nextPages,
      part2PageIndex: startPageIdx,
      foundExistingPart2: true,
      changed: updatedAny,
    };
  }

  // Case B: No 2ª PARTE exists yet -> append cleanly at the end of the last page WITHOUT touching 1ª PARTE
  const part2Lines = applyServiceTimeToPart2Lines([], serviceTimeFormatted || '00 a 00 m 00 d', {
    datePtBr: closingDatePtBr,
    guarnicao,
    updateClosingDate: hasDateUpdate,
  });
  const part2Blocks: AlteracaoHtmlBlock[] = [
    { html: '<p><br></p>', isSpacer: true, preserveIfSpacer: true },
    ...buildPart2HtmlBlocksFromLines(part2Lines),
  ];

  const lastIdx = safePages.length - 1;
  const lockedPagesBefore = safePages.slice(0, lastIdx);
  const lastPageEls = parsePageElements(safePages[lastIdx]).filter((el, idx, arr) => {
    // Strip trailing blank spacers only at the very end so we add one clean spacer before 2ª PARTE
    if (idx === arr.length - 1 && isSpacerElement(el)) return false;
    return true;
  });
  const lockedLastPageHtmls = lastPageEls.map((e) => e.outerHTML);

  if (paginateOptions && typeof document !== 'undefined') {
    const tailPages = paginateAlteracaoBlocksInDom(part2Blocks, {
      ...paginateOptions,
      lockedPrefixHtmls: lockedLastPageHtmls,
      startOnContinuationPage: lastIdx > 0,
      preserveTrailingSpacers: true,
    });
    const combined = [...lockedPagesBefore, ...tailPages];
    return {
      pagesHtml: combined,
      part2PageIndex: Math.max(0, combined.length - 1),
      foundExistingPart2: false,
      changed: true,
    };
  }

  const appendedLast = [
    ...lockedLastPageHtmls,
    ...part2Blocks.map((b) => b.html),
  ].join('\n');
  const nextPages = [...lockedPagesBefore, appendedLast];
  return {
    pagesHtml: nextPages,
    part2PageIndex: lastIdx,
    foundExistingPart2: false,
    changed: true,
  };
}

/**
 * Inspects the live edited A4 sheets and returns the ordered list of structuredDoc item IDs
 * that still have visible, non-empty content on at least one sheet.
 * When the user deletes all text/table of a subtopic or entire topic directly in the sheet,
 * its ID disappears from this list so the sidebar checkboxes automatically uncheck in sync.
 */
export function detectLivePresentItemIds(
  livePagesHtml: string[],
  structuredDoc: StructuredAlteracaoDoc
): string[] {
  if (!structuredDoc || structuredDoc.items.length === 0) return [];
  if (typeof DOMParser === 'undefined') {
    return structuredDoc.items.map((i) => i.id);
  }

  const presentTaggedIds = new Set<string>();
  let sawAnyAltDataAttr = false;
  let totalNonEmptyTextLen = 0;
  let totalTables = 0;
  const allBlocksText: string[] = [];
  const allTablesText: string[] = [];

  for (const pageHtml of livePagesHtml) {
    const doc = new DOMParser().parseFromString(pageHtml || '', 'text/html');
    if (
      !sawAnyAltDataAttr &&
      doc.body.querySelector('[data-alt-item], [data-alt-group], [data-alt-month], [data-alt-part2]')
    ) {
      sawAnyAltDataAttr = true;
    }

    const taggedEls = Array.from(doc.body.querySelectorAll<HTMLElement>('[data-alt-item]'));
    for (const el of taggedEls) {
      const id = el.getAttribute('data-alt-item');
      if (!id) continue;
      if (el.tagName.toUpperCase() === 'TABLE') {
        const hasCellText = Array.from(el.querySelectorAll('td, th')).some(
          (cell) => (cell.textContent || '').replace(/\u00a0/g, ' ').trim().length > 0
        );
        if (hasCellText) {
          presentTaggedIds.add(id);
        }
      } else {
        const txt = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
        if (txt.length > 0) {
          presentTaggedIds.add(id);
        }
      }
    }

    const bodyText = (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim();
    totalNonEmptyTextLen += bodyText.length;

    const tables = Array.from(doc.body.querySelectorAll('table'));
    totalTables += tables.length;
    if (!sawAnyAltDataAttr) {
      for (const tbl of tables) {
        allTablesText.push(normalizeKey(tbl.textContent || ''));
      }
      for (const node of Array.from(doc.body.querySelectorAll('p, div, li'))) {
        const norm = normalizeKey(node.textContent || '');
        if (norm) allBlocksText.push(norm);
      }
    }
  }

  // If the entire sheet stack was cleared by the user, everything is unchecked
  if (totalNonEmptyTextLen === 0 && totalTables === 0) {
    return [];
  }

  if (sawAnyAltDataAttr) {
    return structuredDoc.items
      .filter((item) => presentTaggedIds.has(item.id))
      .map((item) => item.id);
  }

  // Legacy fallback for documents archived before data-alt-* tags existed
  return structuredDoc.items
    .filter((item) => {
      if (item.kind === 'table' && item.tableRows?.length) {
        const firstCell = normalizeKey(
          item.tableRows.flat().find((c) => c.trim().length > 0) || ''
        );
        return firstCell
          ? allTablesText.some((t) => t.includes(firstCell))
          : allTablesText.length > 0;
      }
      const wantedSub = item.subtitle ? normalizeKey(item.subtitle) : '';
      const wantedPara = item.paragraphs[0]
        ? normalizeKey(item.paragraphs[0].slice(0, 44))
        : '';
      return allBlocksText.some(
        (txt) =>
          (wantedSub && txt === wantedSub) ||
          (wantedPara && txt.includes(wantedPara))
      );
    })
    .map((item) => item.id);
}


