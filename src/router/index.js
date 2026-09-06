import Vue from "vue";
import VueRouter from "vue-router";
Vue.use(VueRouter);
export default new VueRouter({
  routes: [
    { path: "/", name: "Todo", component: () => import("../views/Todo.vue") },
    {
      path: "/done",
      name: "Done",
      component: () => import("../views/Done.vue")
    },
    {
      path: "/settings",
      name: "Settings",
      component: () => import("../views/Settings.vue")
    }
  ]
});
