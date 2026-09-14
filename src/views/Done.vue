<template>
  <div class="root">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!groups.length && !error" class="empty">还没有完成记录</p>
    <div class="list" v-for="group in groups" :key="group.date">
      <div class="group">{{ dateLabel(group.date) }}</div>
      <div class="item" v-for="done in group.items" :key="done.id">
        <div class="item-main">
          <p
            ref="taskText"
            :data-task-id="done.id"
            :class="{
              concealed: done.hidden,
              'text-collapsed': !isTextExpanded(done.id)
            }"
          >
            {{ done.hidden ? "••••••" : done.content }}
          </p>
          <button
            v-if="!done.hidden && textOverflowIds.includes(done.id)"
            class="task-expand"
            type="button"
            :aria-expanded="String(isTextExpanded(done.id))"
            @click="toggleText(done.id)"
          >
            {{ isTextExpanded(done.id) ? "收起" : "展开" }}
          </button>
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
    return {
      groups: [],
      error: "",
      expandedId: "",
      expandedTextIds: [],
      textOverflowIds: []
    };
  },
  methods: {
    isTextExpanded(id) {
      return this.expandedTextIds.includes(id);
    },
    toggleText(id) {
      const collapsing = this.isTextExpanded(id);
      this.expandedTextIds = collapsing
        ? this.expandedTextIds.filter(itemId => itemId !== id)
        : [...this.expandedTextIds, id];
      if (collapsing) this.$nextTick(this.measureTextOverflow);
    },
    measureTextOverflow() {
      const refs = this.$refs.taskText || [];
      const elements = Array.isArray(refs) ? refs : [refs];
      const previous = new Set(this.textOverflowIds);
      this.textOverflowIds = elements
        .filter(element => {
          const id = element.dataset.taskId;
          const task = this.groups
            .flatMap(group => group.items)
            .find(item => item.id === id);
          return this.isTextExpanded(id)
            ? previous.has(id)
            : (task && /[\r\n]/.test(task.content)) ||
                element.scrollWidth > element.clientWidth + 1 ||
                element.scrollHeight > element.clientHeight + 1;
        })
        .map(element => element.dataset.taskId);
    },
    onWindowResize() {
      this.$nextTick(this.measureTextOverflow);
    },
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
        const visibleIds = new Set(
          this.groups.flatMap(group => group.items.map(item => item.id))
        );
        this.expandedTextIds = this.expandedTextIds.filter(id =>
          visibleIds.has(id)
        );
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
        this.$nextTick(this.measureTextOverflow);
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
    window.addEventListener("resize", this.onWindowResize);
  },
  beforeDestroy() {
    window.removeEventListener("tasks:changed", this.reload);
    window.removeEventListener("resize", this.onWindowResize);
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--task-font-size, 16px);
  line-height: 1.75;
}
.item-main p.text-collapsed {
  max-height: 1.75em;
  white-space: nowrap;
  text-overflow: ellipsis;
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
.task-expand {
  align-self: flex-start;
  margin-top: 3px;
  padding: 1px 5px;
  border: 0;
  background: rgba(255, 255, 255, 0.08);
  color: #bdc9c1;
  line-height: 20px;
  white-space: nowrap;
}
.task-expand:hover {
  background: rgba(255, 255, 255, 0.14);
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
