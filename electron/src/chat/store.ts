//! Rozmowy zakładki Czat: `<configDir>/chats/<id>.json` + `index.json` (id, tytuł, data),
//! żeby lista rozmów nie czytała przy starcie wszystkich plików.

import fs from "node:fs";
import path from "node:path";
import { chatMeta, parseChat, sortChats, type ChatMeta } from "../../../src/chat";
import { writeAtomic } from "../config";

const ID_RE = /^[0-9a-f-]{8,64}$/i;
const INDEX = "index.json";

export class ChatStore {
  constructor(private dir: string) {}

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`złe id rozmowy: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  private readIndex(): ChatMeta[] | null {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(this.dir, INDEX), "utf8")) as unknown;
      return Array.isArray(list) ? (list as ChatMeta[]) : null;
    } catch {
      return null;
    }
  }

  private writeIndex(list: ChatMeta[]): void {
    writeAtomic(path.join(this.dir, INDEX), JSON.stringify(sortChats(list)));
  }

  /** Indeks z plików rozmów (brak albo zepsuty `index.json`). */
  private rebuild(): ChatMeta[] {
    const list: ChatMeta[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith(".json") || name === INDEX) continue;
      try {
        const chat = parseChat(fs.readFileSync(path.join(this.dir, name), "utf8"));
        if (chat) list.push(chatMeta(chat));
      } catch {
        // nieczytelny plik pomijamy, nie kasujemy
      }
    }
    this.writeIndex(list);
    return sortChats(list);
  }

  list(): ChatMeta[] {
    fs.mkdirSync(this.dir, { recursive: true });
    return sortChats(this.readIndex() ?? this.rebuild());
  }

  /** Treść pliku rozmowy; `null` = nie ma. */
  load(id: string): string | null {
    try {
      return fs.readFileSync(this.file(id), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  save(json: string): void {
    const chat = parseChat(json);
    if (!chat) throw new Error("zły format rozmowy");
    fs.mkdirSync(this.dir, { recursive: true });
    writeAtomic(this.file(chat.id), json);
    const list = (this.readIndex() ?? []).filter((c) => c.id !== chat.id);
    this.writeIndex([...list, chatMeta(chat)]);
  }

  delete(id: string): void {
    fs.rmSync(this.file(id), { force: true });
    this.writeIndex((this.readIndex() ?? []).filter((c) => c.id !== id));
  }
}
