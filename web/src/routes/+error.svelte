<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
</script>

<section class="py-8">
  <h2 class="text-lg font-semibold">{page.status}</h2>
  <p class="text-muted">{page.error?.message ?? 'Something went wrong.'}</p>
  <a href={resolve('/')}>Back to main</a>
</section>
