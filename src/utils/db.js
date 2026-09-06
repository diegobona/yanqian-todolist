import { TaskRepository } from "@/services/taskRepository";
let repository;
export default {
  initDB(directory) {
    if (!repository)
      repository = new TaskRepository({
        directory,
        filename:
          process.env.NODE_ENV !== "production" ? "data-dev.json" : "data.json"
      });
    return repository;
  },
  get repository() {
    if (!repository) throw Error("数据尚未初始化");
    return repository;
  },
  get(key) {
    return key
      .split(".")
      .reduce(
        (value, part) => value && value[part],
        this.repository.snapshot()
      );
  }
};
