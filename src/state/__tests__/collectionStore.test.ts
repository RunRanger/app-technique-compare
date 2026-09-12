import { useCollectionStore } from '@/state/collectionStore';
import type { VideoMeta } from '@/types';

const meta: VideoMeta = { durationSeconds: 5, width: 1920, height: 1080, fps: 30 };

describe('collectionStore', () => {
  beforeEach(() => useCollectionStore.setState({ items: [] }));

  it('adds an entry and returns it', () => {
    const item = useCollectionStore
      .getState()
      .add({ name: 'Vault', ref: { kind: 'mediaLibrary', id: 'a1' }, meta });

    expect(item.name).toBe('Vault');
    expect(useCollectionStore.getState().items).toHaveLength(1);
  });

  it('puts new entries first', () => {
    const store = useCollectionStore.getState();
    store.add({ name: 'first', ref: { kind: 'mediaLibrary', id: 'a' }, meta });
    useCollectionStore.getState().add({ name: 'second', ref: { kind: 'mediaLibrary', id: 'b' }, meta });

    expect(useCollectionStore.getState().items[0]!.name).toBe('second');
  });

  it('falls back to a placeholder rather than an empty name', () => {
    const item = useCollectionStore
      .getState()
      .add({ name: '   ', ref: { kind: 'mediaLibrary', id: 'a' }, meta });
    expect(item.name).toBe('Untitled clip');
  });

  it('keeps the existing name when a rename is blank', () => {
    const item = useCollectionStore
      .getState()
      .add({ name: 'Keep me', ref: { kind: 'mediaLibrary', id: 'a' }, meta });

    useCollectionStore.getState().rename(item.id, '  ');
    expect(useCollectionStore.getState().items[0]!.name).toBe('Keep me');
  });

  it('stores the mirror flag per entry', () => {
    const item = useCollectionStore
      .getState()
      .add({ name: 'Reversed', ref: { kind: 'mediaLibrary', id: 'a' }, meta });

    expect(item.mirrored).toBeUndefined();

    useCollectionStore.getState().setMirrored(item.id, true);
    expect(useCollectionStore.getState().items[0]!.mirrored).toBe(true);

    useCollectionStore.getState().setMirrored(item.id, false);
    expect(useCollectionStore.getState().items[0]!.mirrored).toBe(false);
  });

  it('merges late-discovered metadata without dropping the entry', () => {
    const item = useCollectionStore
      .getState()
      .add({ name: 'Clip', ref: { kind: 'mediaLibrary', id: 'a' }, meta });

    useCollectionStore.getState().updateMeta(item.id, { fps: 59.94 });
    const stored = useCollectionStore.getState().items[0]!;
    expect(stored.meta.fps).toBeCloseTo(59.94);
    expect(stored.meta.width).toBe(1920);
  });

  it('removes only the requested entry', () => {
    const store = useCollectionStore.getState();
    const a = store.add({ name: 'a', ref: { kind: 'mediaLibrary', id: 'a' }, meta });
    useCollectionStore.getState().add({ name: 'b', ref: { kind: 'mediaLibrary', id: 'b' }, meta });

    useCollectionStore.getState().remove(a.id);
    const names = useCollectionStore.getState().items.map((i) => i.name);
    expect(names).toEqual(['b']);
  });
});
