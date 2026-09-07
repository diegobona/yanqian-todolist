<template>
  <section class="task-screenshots" @click.stop>
    <button
      ref="summary"
      class="screenshot-summary"
      type="button"
      :aria-expanded="String(expanded)"
      @click="$emit('toggle', task.id)"
    >
      <span aria-hidden="true">{{ expanded ? "▾" : "▸" }}</span>
      {{ task.screenshots.length }} 张截图
    </button>
    <div v-if="expanded" class="screenshot-gallery">
      <div
        class="screenshot-card"
        v-for="(screenshot, index) in task.screenshots"
        :key="screenshot.id"
      >
        <button
          class="screenshot-thumb"
          type="button"
          :aria-label="`预览第 ${index + 1} 张截图`"
          @click="openPreview(screenshot, $event)"
        >
          <img
            v-if="images[screenshot.id]"
            :src="images[screenshot.id]"
            :alt="`事项截图 ${index + 1}`"
          />
          <span v-else>正在读取截图…</span>
        </button>
        <button
          class="screenshot-delete"
          type="button"
          :aria-label="`删除第 ${index + 1} 张截图`"
          title="删除截图"
          @click="$emit('delete', screenshot.id)"
        >
          ×
        </button>
      </div>
    </div>
    <div
      v-if="preview"
      class="screenshot-preview"
      role="dialog"
      aria-modal="true"
      aria-label="截图预览"
      @click.self="closePreview"
    >
      <button
        ref="previewClose"
        class="preview-close"
        type="button"
        aria-label="关闭截图预览"
        @click="closePreview"
      >
        ×
      </button>
      <img :src="preview.url" alt="截图大图预览" />
      <button
        class="preview-delete"
        type="button"
        @click="$emit('delete', preview.id)"
      >
        删除截图
      </button>
    </div>
  </section>
</template>

<script>
import taskClient from "@/utils/taskClient";

export default {
  name: "TaskScreenshots",
  props: {
    task: { type: Object, required: true },
    list: { type: String, required: true },
    expanded: { type: Boolean, default: false }
  },
  data() {
    return { images: {}, preview: null, lastFocus: null, loadToken: 0 };
  },
  watch: {
    expanded(value) {
      if (value) this.loadImages();
      else this.clearImages();
    },
    task: {
      deep: true,
      handler(value) {
        if (
          value.hidden ||
          (this.preview &&
            !value.screenshots.some(item => item.id === this.preview.id))
        )
          this.closePreview(false);
        if (this.expanded && !value.hidden) this.loadImages();
      }
    }
  },
  methods: {
    async loadImages() {
      if (!this.expanded || this.task.hidden) return;
      const token = ++this.loadToken;
      for (const screenshot of this.task.screenshots) {
        if (this.images[screenshot.id]) continue;
        try {
          const url = await taskClient.attachment("readScreenshot", {
            list: this.list,
            taskId: this.task.id,
            screenshotId: screenshot.id
          });
          if (token === this.loadToken && this.expanded && !this.task.hidden)
            this.$set(this.images, screenshot.id, url);
        } catch (error) {
          if (token === this.loadToken) this.$emit("error", error.message);
        }
      }
    },
    openPreview(screenshot, event) {
      const url = this.images[screenshot.id];
      if (!url) return;
      this.lastFocus = event && event.currentTarget;
      this.preview = { id: screenshot.id, url };
      this.$nextTick(() => {
        if (this.$refs.previewClose) this.$refs.previewClose.focus();
      });
    },
    closePreview(restoreFocus = true) {
      const target = this.lastFocus;
      this.preview = null;
      this.lastFocus = null;
      if (restoreFocus && target)
        this.$nextTick(() => {
          if (document.body.contains(target)) target.focus();
        });
    },
    clearImages() {
      this.loadToken += 1;
      this.closePreview(false);
      this.images = {};
    },
    onKeydown(event) {
      if (event.key === "Escape" && this.preview) this.closePreview();
    }
  },
  mounted() {
    window.addEventListener("keydown", this.onKeydown);
    if (this.expanded) this.loadImages();
  },
  beforeDestroy() {
    window.removeEventListener("keydown", this.onKeydown);
    this.clearImages();
  }
};
</script>

<style lang="scss" scoped>
.task-screenshots {
  width: 100%;
  box-sizing: border-box;
  padding-left: 23px;
}
.screenshot-summary {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0.78;
  padding: 1px 0 5px;
  font-size: 12px;
  cursor: pointer;
}
.screenshot-gallery {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 0 0 7px;
}
.screenshot-card {
  position: relative;
  max-width: 100%;
}
.screenshot-thumb {
  display: block;
  width: 100%;
  min-height: 42px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.26);
  color: inherit;
  padding: 0;
  cursor: zoom-in;
}
.screenshot-thumb img {
  display: block;
  width: 100%;
  max-height: 180px;
  object-fit: contain;
}
.screenshot-thumb span {
  display: block;
  padding: 12px;
  font-size: 12px;
  opacity: 0.7;
}
.screenshot-delete {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 12px;
  color: white;
  background: rgba(0, 0, 0, 0.72);
  cursor: pointer;
}
.screenshot-preview {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 38px 16px 50px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.88);
}
.screenshot-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.preview-close,
.preview-delete {
  position: absolute;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.7);
  cursor: pointer;
}
.preview-close {
  top: 9px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 14px;
  font-size: 20px;
}
.preview-delete {
  bottom: 12px;
  border-radius: 4px;
  padding: 5px 10px;
}
</style>
