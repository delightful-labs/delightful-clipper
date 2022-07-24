//@TODO: fix types.
//This article can help: https://stackoverflow.com/questions/64131176/svelte-custom-event-on-svelte-typescript
export function clickOutside(node) {
  const handleClick = (event: MouseEvent) => {
    if (!node.contains(event.target)) {
      node.dispatchEvent(new CustomEvent("outclick"));
    }
  };

  document.addEventListener("click", handleClick, true);

  return {
    destroy() {
      document.removeEventListener("click", handleClick, true);
    }
  };
}