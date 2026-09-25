<template>
  <image class="home-picture" :src="failed || !src ? fallback : src" :mode="mode" @error="failed = true" />
</template>
<script>
export default {
  options: { virtualHost: true },
  props: {
    src: { type: String, default: '' },
    mode: { type: String, default: 'aspectFill' },
    fallback: { type: String, default: '/static/cover-default.png' }
  },
  data() { return { failed: false } },
  watch: { src() { this.failed = false } }
}
</script>
<style scoped>
.home-picture { display: block; width: 100%; height: 100%; }
</style>
