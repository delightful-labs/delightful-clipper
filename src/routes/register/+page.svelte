<script>
  import RegistrationForm from '$components/RegistrationForm.svelte'
  import { mainService } from '$lib/machines/main'
  import { useSelector } from '@xstate/svelte'
  import FeaturedContent from '$components/FeaturedContent.svelte'

  const userState = useSelector(mainService, (state) => state.value)

  mainService.send({ type: 'REGISTER'})
</script>

<!--@TODO: Registration could easily be a page instead of a component-->
{#if $userState === 'unauthenticated'}
  <FeaturedContent>
    <RegistrationForm />
  </FeaturedContent>
{:else}
  <FeaturedContent>
    <p>You are registered!</p>
    <p>You can now return <a href="/">home</a> or <a href="/add">add your first article</a>.</p>
  </FeaturedContent>
{/if}
