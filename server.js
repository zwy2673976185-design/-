const express = require('express');
const app = express();
const path = require('path');

app.use(express.json());

// 静态文件：自动加载 index.html
app.use(express.static(path.join(__dirname)));

// 数据
let tools = [
  {
    id: 1,
    title: "HTML 基础",
    content: "学习标签、结构、元素",
    videoUrl: "https://www.w3school.com.cn/i/movie.mp4"
  },
  {
    id: 2,
    title: "JS 入门",
    content: "变量、函数、判断",
    videoUrl: ""
  }
];

// 接口
app.get('/api/tools', (req, res) => {
  res.json(tools);
});

// 启动
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("运行在：" + PORT);
});
