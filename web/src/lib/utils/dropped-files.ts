/**
 * Turns a drop event into a flat list of files (spec §8.6).
 *
 * A dropped folder arrives as a single `FileSystemEntry`, not as its contents.
 * Browsers that expose the (non-standard but universally shipped)
 * `webkitGetAsEntry()` let us walk the tree; when it is missing we fall back to
 * `dataTransfer.files`, which is correct for plain file drags.
 */

/** `readEntries` only returns one batch per call, so draining needs a loop. */
function readDirectory(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

function collectDirectory(entry: FileSystemDirectoryEntry, files: File[]): Promise<void> {
  return (async () => {
    const reader = entry.createReader();

    for (;;) {
      const batch = await readDirectory(reader);

      if (batch.length === 0) {
        break;
      }

      for (const child of batch) {
        await collectEntry(child, files);
      }
    }
  })();
}

function collectEntry(entry: FileSystemEntry, files: File[]): Promise<void> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => {
          files.push(file);
          resolve();
        },
        // An unreadable entry (permissions, vanished file) must not abort the
        // rest of the drop.
        () => resolve(),
      );
    });
  }

  if (entry.isDirectory) {
    return collectDirectory(entry as FileSystemDirectoryEntry, files);
  }

  return Promise.resolve();
}

/**
 * Reads the files behind a `DataTransfer` (drop or paste payload), expanding
 * directories recursively when the browser supports entry walking.
 */
export async function filesFromDataTransfer(dataTransfer: DataTransfer | null): Promise<File[]> {
  if (!dataTransfer) {
    return [];
  }

  const items = Array.from(dataTransfer.items ?? []);
  const canWalkEntries = items.some((item) => typeof item.webkitGetAsEntry === 'function');

  if (!canWalkEntries) {
    return Array.from(dataTransfer.files);
  }

  // Read every entry synchronously: the `DataTransfer` is neutered once the
  // event handler yields, so `webkitGetAsEntry()` cannot be deferred.
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  const files: File[] = [];

  for (const entry of entries) {
    await collectEntry(entry, files);
  }

  // Some browsers report entries but yield nothing (e.g. a drag from a native
  // app). Fall back so a drop is never silently swallowed.
  return files.length > 0 ? files : Array.from(dataTransfer.files);
}
