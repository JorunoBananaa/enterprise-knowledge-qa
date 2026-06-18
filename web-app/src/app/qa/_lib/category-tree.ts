import type { CategoryItem, CatTreeNode } from "../_types";

export function buildCatTree(items: CategoryItem[]): CatTreeNode[] {
  const map = new Map<number, CatTreeNode>();
  const roots: CatTreeNode[] = [];

  for (const item of items) {
    const node: CatTreeNode = {
      key: `cat-${item.id}`,
      title: item.name,
      categoryId: item.id,
      parentId: item.parent_id,
      _children: [],
    };
    map.set(item.id, node);
  }

  for (const node of map.values()) {
    if (node.parentId != null && map.has(node.parentId)) {
      map.get(node.parentId)!._children!.push(node);
    } else {
      roots.push(node);
    }
  }

  const clean = (nodes: CatTreeNode[]) => {
    for (const node of nodes) {
      if (node._children && node._children.length > 0) {
        node.children = node._children;
        clean(node._children);
      }
      delete node._children;
    }
  };
  clean(roots);
  return roots;
}
