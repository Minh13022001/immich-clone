<script lang="ts">
  import type { Snippet } from 'svelte';

  import { filesFromDataTransfer } from '$lib/utils/dropped-files';

  interface Props {
    /** Called with the flattened selection (directories already expanded). */
    onFiles: (files: File[]) => void;
    children: Snippet;
  }

  let { onFiles, children }: Props = $props();

  let dragging = $state(false);

  function acceptsTransfer(dataTransfer: DataTransfer | null): boolean {
    // Internal drags (list reordering, text selection) carry no `Files` entry;
    // ignoring them keeps the overlay from flashing during normal use.
    return dataTransfer?.types.includes('Files') ?? false;
  }

  function onDragOver(event: DragEvent): void {
    if (!acceptsTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragging = true;
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;

    void filesFromDataTransfer(event.dataTransfer).then((files) => {
      if (files.length > 0) {
        onFiles(files);
      }
    });
  }

  /** Paste goes to the window, so the overlay does not need focus (spec §8.6). */
  function onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);

    if (files.length > 0) {
      onFiles(files);
    }
  }
</script>

<svelte:window onpaste={onPaste} />

<div
  class="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center transition-colors {dragging
    ? 'border-accent bg-accent/10'
    : 'border-border bg-surface'}"
  role="region"
  aria-label="Upload drop zone"
  ondragover={onDragOver}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  {@render children()}
</div>
