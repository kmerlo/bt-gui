import { useCallback, useEffect, useState } from 'react'
import type { NodeConfig, StrategyTree } from '../types/bt'
import { useBtStore, buildPresetForTree } from '../bt/store/btStore'
import { createDefaultTree } from '../bt/store/treeOps'
import { strategiesApi } from '../api/bt'

export function findDuplicateName(root: NodeConfig): string | null {
  const findDup = (node: NodeConfig): string | null => {
    if (node.children.length > 0) {
      const seen = new Map<string, string>()
      for (const c of node.children) {
        if (seen.has(c.name)) return `'${c.name}' duplicato sotto '${node.name}' — rinomina uno dei due`
        seen.set(c.name, c.id ?? c.name)
      }
      for (const c of node.children) {
        const d = findDup(c)
        if (d) return d
      }
    }
    return null
  }
  return findDup(root)
}

function assembleTreeToSave(tree: StrategyTree, targetName: string): StrategyTree {
  const preset = buildPresetForTree(useBtStore.getState)
  return {
    ...tree,
    name: targetName,
    root: { ...tree.root, name: targetName },
    preset,
  } as unknown as StrategyTree
}

export function useStrategySave() {
  const [nameDraft, setNameDraft] = useState('')
  const [savedId, setSavedId] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [rows, setRows] = useState<{ id: number; name: string }[]>([])
  const [loadId, setLoadId] = useState('')
  const tree = useBtStore((s) => s.tree)
  const setTree = useBtStore((s) => s.setTree)

  useEffect(() => {
    if (tree) setNameDraft(tree.name)
  }, [tree?.name])

  const refreshList = useCallback(() => {
    strategiesApi
      .list()
      .then((l) => setRows(l.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => {
        /* ignore */
      })
  }, [])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  const handleSave = async (): Promise<void> => {
    if (!tree) return
    window.dispatchEvent(new Event('bt-before-save'))
    await new Promise((r) => setTimeout(r, 0))
    const freshTree = useBtStore.getState().tree ?? tree
    const dup = findDuplicateName(freshTree.root as NodeConfig)
    if (dup) {
      setMsg(`Errore: ${dup}`)
      return
    }
    const targetName = nameDraft.trim() || freshTree.name
    const toSave = assembleTreeToSave(freshTree, targetName)
    try {
      if (savedId != null) {
        const r = await strategiesApi.update(savedId, toSave)
        setTree(r.tree as unknown as StrategyTree)
        setMsg(`updated #${savedId}`)
      } else {
        const r = await strategiesApi.create(toSave)
        setSavedId(r.id)
        setTree(r.tree as unknown as StrategyTree)
        setMsg(`saved #${r.id}`)
      }
      refreshList()
    } catch (e) {
      const m = String(e)
      if (m.includes('409') && m.includes('already exists')) setMsg(`Errore: '${targetName}' già esistente — cambia nome`)
      else setMsg(m)
    }
  }

  const handleSaveAsNew = async (): Promise<void> => {
    if (!tree) return
    window.dispatchEvent(new Event('bt-before-save'))
    await new Promise((r) => setTimeout(r, 0))
    const freshTree = useBtStore.getState().tree ?? tree
    const dup = findDuplicateName(freshTree.root as NodeConfig)
    if (dup) {
      setMsg(`Errore: ${dup}`)
      return
    }
    const targetName = nameDraft.trim() || freshTree.name
    const toSave = assembleTreeToSave(freshTree, targetName)
    try {
      const r = await strategiesApi.create(toSave)
      setSavedId(r.id)
      setTree(r.tree as unknown as StrategyTree)
      setMsg(`saved as new #${r.id}`)
      refreshList()
    } catch (e) {
      const m = String(e)
      if (m.includes('409') && m.includes('already exists')) setMsg(`Errore: '${targetName}' già esistente — cambia nome`)
      else setMsg(m)
    }
  }

  const handleLoad = async (): Promise<void> => {
    const sid = Number(loadId)
    if (!sid) return
    try {
      const r = await strategiesApi.get(sid)
      const t = r.tree as unknown as StrategyTree
      setTree(t!)
      setNameDraft(t!.name)
      setSavedId(sid)
      setMsg(`loaded #${sid}`)
    } catch (e) {
      setMsg(String(e))
    }
  }

  const handleNew = (): void => {
    const def = createDefaultTree()
    setTree(def)
    setNameDraft(def.name)
    setSavedId(null)
    setMsg('new tree')
  }

  const treeNameCommit = (): void => {
    if (!tree) return
    const v = nameDraft.trim()
    if (!v || v === tree.name) return
    setTree({ ...tree, name: v, root: { ...tree.root, name: v } })
  }

  return { nameDraft, setNameDraft, savedId, setSavedId, msg, setMsg, rows, loadId, setLoadId, handleSave, handleSaveAsNew, handleLoad, handleNew, treeNameCommit, refreshList }
}
