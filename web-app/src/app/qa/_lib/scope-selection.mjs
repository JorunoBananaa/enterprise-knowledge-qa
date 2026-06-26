function normalizeIds(ids) {
  return Array.from(new Set(ids)).filter((id) => Number.isFinite(id));
}

function toCatKey(id) {
  return `cat-${id}`;
}

function selectedVisibleCount(documentIds, visibleDocumentIds) {
  const selected = new Set(documentIds);
  return visibleDocumentIds.filter((id) => selected.has(id)).length;
}

export function getEffectiveDocumentIds({
  categoryIds,
  documentIds,
  activeCategoryId,
  visibleDocumentIds,
}) {
  if (activeCategoryId == null || !categoryIds.includes(activeCategoryId)) {
    return normalizeIds(documentIds);
  }

  return normalizeIds([...documentIds, ...visibleDocumentIds]);
}

export function getCategoryCheckKeys({
  categoryIds,
  documentIds,
  activeCategoryId,
  visibleDocumentIds,
}) {
  const checked = new Set(categoryIds.map(toCatKey));
  const halfChecked = new Set();

  if (
    activeCategoryId != null &&
    !categoryIds.includes(activeCategoryId) &&
    visibleDocumentIds.length > 0
  ) {
    const count = selectedVisibleCount(documentIds, visibleDocumentIds);
    if (count === visibleDocumentIds.length) {
      checked.add(toCatKey(activeCategoryId));
    } else if (count > 0) {
      halfChecked.add(toCatKey(activeCategoryId));
    }
  }

  return {
    checked: Array.from(checked),
    halfChecked: Array.from(halfChecked),
  };
}

export function updateActiveCategoryDocuments({
  nextVisibleDocumentIds,
  categoryIds,
  documentIds,
  activeCategoryId,
  visibleDocumentIds,
}) {
  if (activeCategoryId == null) {
    return { categoryIds, documentIds };
  }

  const visible = new Set(visibleDocumentIds);
  const retainedDocumentIds = documentIds.filter((id) => !visible.has(id));
  const activeCategoryRemoved = categoryIds.filter(
    (id) => id !== activeCategoryId,
  );

  if (
    visibleDocumentIds.length > 0 &&
    nextVisibleDocumentIds.length === visibleDocumentIds.length
  ) {
    return {
      categoryIds: normalizeIds([...activeCategoryRemoved, activeCategoryId]),
      documentIds: retainedDocumentIds,
    };
  }

  return {
    categoryIds: activeCategoryRemoved,
    documentIds: normalizeIds([
      ...retainedDocumentIds,
      ...nextVisibleDocumentIds,
    ]),
  };
}

export function updateCategorySelection({
  nextCategoryIds,
  categoryIds,
  documentIds,
  activeCategoryId,
  visibleDocumentIds,
}) {
  const nextCategorySet = new Set(nextCategoryIds);
  const categorySet = new Set(categoryIds);

  if (
    activeCategoryId == null ||
    nextCategorySet.has(activeCategoryId) === categorySet.has(activeCategoryId)
  ) {
    return { categoryIds: normalizeIds(nextCategoryIds), documentIds };
  }

  const visible = new Set(visibleDocumentIds);
  const nextDocumentIds = documentIds.filter((id) => !visible.has(id));

  return {
    categoryIds: normalizeIds(nextCategoryIds),
    documentIds: nextDocumentIds,
  };
}
