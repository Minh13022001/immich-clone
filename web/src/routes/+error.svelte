<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
</script>

<section class="error-page">
  <h2>{page.status}</h2>
  <p class="muted">{page.error?.message ?? 'Something went wrong.'}</p>
  <a href={resolve('/')}>Back to users</a>
</section>

<style>
  .error-page {
    padding: 2rem 0;
  }
</style>
