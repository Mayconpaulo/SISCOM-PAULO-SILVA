import {
  AlteracaoHtmlBlock,
  ParsedAlteracaoSectionItem,
  StructuredAlteracaoDoc,
  buildAlteracaoTableHtml,
  renderItemBlocksForInsertion,
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
  // Bold short subtitle or section heading line
  const strong = el.querySelector('strong, b');
  if (strong && normalizeKey(strong.textContent || '') === normalizeKey(txt) && txt.length <= 140) {
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

function elementsToReflowBlocks(
  nodes: Array<{ el?: HTMLElement; block?: AlteracaoHtmlBlock; crossedPageBreak?: boolean }>,
  prefixEndedWithSpacer: boolean
): AlteracaoHtmlBlock[] {
  const blocks: AlteracaoHtmlBlock[] = [];
  const spacer = (): AlteracaoHtmlBlock => ({ html: '<p><br></p>', isSpacer: true });

  const lastIsSpacer = () =>
    blocks.length > 0 ? Boolean(blocks[blocks.length - 1].isSpacer) : prefixEndedWithSpacer;

  const needsLeadingSpacerBeforeEl = (el: HTMLElement): boolean => {
    if (el.hasAttribute('data-alt-month') || isMonthHeadingEl(el)) return true;
    if (el.hasAttribute('data-alt-group')) return true;
    if (el.hasAttribute('data-alt-part2')) return true;
    return false;
  };

  for (const entry of nodes) {
    if (entry.block) {
      if (entry.block.isSpacer) {
        if (!lastIsSpacer()) {
          blocks.push(spacer());
        }
        continue;
      }
      blocks.push(entry.block);
      continue;
    }

    const el = entry.el!;
    if (isSpacerElement(el)) {
      if (!lastIsSpacer()) {
        blocks.push(spacer());
      }
      continue;
    }

    // If a section/month/group heading crossed a previous page break where its spacer was stripped,
    // restore a single clean spacer before it when pulling it onto the previous page.
    if (entry.crossedPageBreak && needsLeadingSpacerBeforeEl(el) && !lastIsSpacer()) {
      blocks.push(spacer());
    }

    if (el.tagName.toUpperCase() === 'TABLE') {
      const tblBlock = extractTableMetaFromEl(el);
      const itemId = tblBlock.tableMeta?.itemId;
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

    blocks.push({
      html: el.outerHTML,
      keepWithNext: isHeadingKeepWithNext(el),
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
