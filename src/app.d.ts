/// <reference types="@sveltejs/kit" />

// See https://kit.svelte.dev/docs/types#the-app-namespace
// for information about these interfaces
declare namespace App {
  // interface Locals {}
  // interface Platform {}
  // interface Session {}
  // interface Stuff {}
  interface Entry {
    title: string;
    description?: string;
    file: string; //Probably should change to fileName, since is not an embedded file.
    tags: string[];
    cid: string;
    type: string; //@TODO: make enum?
    url?: string; //@TODO: enforce url format?
    author?: string;
    published?: string; //@TODO: enforce time format?
    image?: string; //@TODO: enforce url format?
    source?: string;
  }
}
