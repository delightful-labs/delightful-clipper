<script>
	import { createEventDispatcher, onMount } from 'svelte'

  /**
   * @type {HTMLElement|null}
   */
  export let root = null

  /**
   * @type {string|undefined}
   */
  export let rootMargin = undefined

  /**
   * @type {number|number[]}
   */
   export let threshold = 0

  let options = {
    root: root,
    rootMargin: rootMargin,
    threshold: threshold
  }

  /**
   * @type {HTMLDivElement}
   */
  let sentinel

	const dispatch = createEventDispatcher()

  /**
   * 
   * @param {IntersectionObserverEntry[]} e
   */
	const handleIntersecting = (e) => {
    e[0].isIntersecting ? dispatch('intersecting') : dispatch('notintersecting')
  }

  let observer = new IntersectionObserver(handleIntersecting, options)

  onMount(()=> {
    observer.observe(sentinel)
  })
  
</script>

<div bind:this={sentinel}></div>