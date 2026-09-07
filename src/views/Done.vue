<template>
  <div class="root">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!groups.length && !error" class="empty">还没有完成记录</p>
    <div class="list" v-for="group in groups" :key="group.date">
      <div class="group">{{ dateLabel(group.date) }}</div>
      <div class="item" v-for="done in group.items" :key="done.id">
        <div class="item-main">
          <p
            :class="{ concealed: done.hidden }"
            :title="done.hidden ? '事项已隐藏' : done.content"
          >
            {{ done.hidden ? "••••••" : done.content }}
          </p>
          <i
            :class="[
              'iconfont',
              'visibility-toggle',
              done.hidden ? 'icon-browse' : 'icon-eye-close'
            ]"
            :title="done.hidden ? '显示此事项' : '隐藏此事项'"
            :aria-label="done.hidden ? '显示此事项' : '隐藏此事项'"
            @click="toggleVisibility(done)"
          ></i>
          <button title="恢复为待办" @click="act('restoreDone', done.id)">
            恢复
          </button>
          <button title="移到回收站" @click="act('delete', done.id)">
            删除
          </button>
        </div>
        <TaskScreenshots
          v-if="!done.hidden && done.screenshots && done.screenshots.length"
          :task="done"
          list="doneList"
          :expanded="expandedId === done.id"
          @toggle="toggleScreenshots"
          @delete="deleteScreenshot(done.id, $event)"
          @error="error = $event"
        />
      </div>
    </div>
  </div>
</template>
<script>
import taskClient from "@/utils/taskClient";
import { getDateStr } from "@/utils/common";
import TaskScreenshots from "@/components/TaskScreenshots.vue";
export default {
  name: "Done",
  components: { TaskScreenshots },
  data() {
    return { groups: [], error: "", expandedId: "" };
  },
  methods: {
    dateLabel(value) {
      return /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(value)
        ? getDateStr(value)
        : "日期未知";
    },
    reload() {
      try {
        const byDate = new Map();
        for (const item of taskClient.snapshot().doneList) {
          const key = item.done_date || "日期未知";
          if (!byDate.has(key)) byDate.set(key, []);
          byDate.get(key).push(item);
        }
        this.groups = Array.from(byDate, ([date, items]) => ({
          date,
          items
        })).sort((a, b) => b.date.localeCompare(a.date));
        if (
          this.expandedId &&
          !this.groups.some(group =>
            group.items.some(
              item => item.id === this.expandedId && !item.hidden
            )
          )
        )
          this.expandedId = "";
        this.error = "";
      } catch (error) {
        this.error = error.message;
      }
    },
    toggleVisibility(item) {
      try {
        taskClient.command("setVisibility", {
          list: "doneList",
          id: item.id,
          hidden: !item.hidden
        });
        if (!item.hidden && this.expandedId === item.id) this.expandedId = "";
        this.reload();
        taskClient.changed();
      } catch (error) {
        this.error = error.message;
      }
    },
    act(action, id) {
      try {
        taskClient.command(action, { id, list: "doneList" });
        if (this.expandedId === id) this.expandedId = "";
        this.reload();
        taskClient.changed();
      } catch (error) {
        this.error = error.message;
      }
    },
    toggleScreenshots(id) {
      this.expandedId = this.expandedId === id ? "" : id;
    },
    async deleteScreenshot(taskId, screenshotId) {
      try {
        const value = await taskClient.attachment("deleteScreenshot", {
          list: "doneList",
          taskId,
          screenshotId
        });
        if (value.canceled) return;
        this.reload();
      } catch (error) {
        this.error = error.message;
      }
    }
  },
  created() {
    this.reload();
    window.addEventListener("tasks:changed", this.reload);
  },
  beforeDestroy() {
    window.removeEventListener("tasks:changed", this.reload);
  }
};
</script>
<style lang="scss" scoped>
.root {
  padding: 0 15px 20px;
}
.group {
  position: relative;
  font-size: 13px;
  line-height: 26px;
  margin-top: 4px;
  color: #bfc9d2;
}
.item {
  display: block;
  min-height: 28px;
}
.item-main {
  display: flex;
  align-items: center;
  min-height: 28px;
  gap: 4px;
}
.item-main p {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.concealed {
  letter-spacing: 2px;
  opacity: 0.7;
}
.visibility-toggle {
  flex-shrink: 0;
  padding: 0 3px;
  cursor: pointer;
}
button {
  flex-shrink: 0;
  background: #333;
  border: 1px solid #888;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 11px;
  cursor: pointer;
}
.empty {
  opacity: 0.6;
  font-size: 13px;
}
.error {
  color: #ffcfb8;
  font-size: 12px;
}
</style>
