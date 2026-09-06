import { useCallback, useEffect, useState } from 'react'
import type { NodeConfig, StrategyTree } from '../types/bt'
import { useBtStore, buildPresetForTree } from '../bt/store/btStore'
import { createDefaultTree } from '../bt/store/treeOps'
import { collectReferencedIds } from '../bt/utils/collectIds'
import { dataApi, strategiesApi } from '../api/bt'

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

// Fotografia dei link indicatori/segnali: gli IDs referenziati negli algo vengono
// partizionati per tipo e scritti in preset. Fallback: tutto in indicator_source_ids
// (il BE li risolve comunque e segnala gli stale con warning).
async function snapshotIds(toSave: StrategyTree): Promise<StrategyTree> {
  const collected = collectReferencedIds(toSave)
  const preset = { ...(toSave.preset as unknown as Record<string, unknown>) }
  if (collected.length === 0) {
    preset.indicator_source_ids = []
    preset.signal_source_ids = []
    return { ...toSave, preset } as unknown as StrategyTree
  }
  try {
    const sigs = await dataApi.listSignals()
    const sigSet = new Set(sigs.map((s) => s.id))
    preset.indicator_source_ids = collected.filter((id) => !sigSet.has(id))
    preset.signal_source_ids = collected.filter((id) => sigSet.has(id))
  } catch { /* offline? salva tutto come indicatori, il BE avvisa sugli stale */ }
  if (preset.indicator_source_ids === undefined) preset.indicator_source_ids = collected
  if (preset.signal_source_ids === undefined) preset.signal_source_ids = []
  return { ...toSave, preset } as unknown as StrategyTree
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
    const toSave = await snapshotIds(assembleTreeToSave(freshTree, targetName))
    try {
      if (savedId != null) {
        const r = await strategiesApi.update(savedId, toSave)
        const loaded = r.tree as unknown as StrategyTree | null | undefined
        if (!loaded) { setMsg('invalid tree in response'); return }
        setTree(loaded)
        setMsg(`updated #${savedId}`)
      } else {
        const r = await strategiesApi.create(toSave)
        setSavedId(r.id)
        const loaded2 = r.tree as unknown as StrategyTree | null | undefined
        if (!loaded2) { setMsg('invalid tree in response'); return }
        setTree(loaded2)
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
    const toSave = await snapshotIds(assembleTreeToSave(freshTree, targetName))
    try {
      const r = await strategiesApi.create(toSave)
      setSavedId(r.id)
      const loaded3 = r.tree as unknown as StrategyTree | null | undefined
      if (!loaded3) { setMsg('invalid tree in response'); return }
      setTree(loaded3)
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
      const t = r.tree as unknown as StrategyTree | null | undefined
      if (!t) {
        setMsg(`strategy #${sid} has no tree data`)
        return
      }
      setTree(t)
      setNameDraft(t.name)
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
