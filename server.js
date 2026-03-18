const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 这里就是你软件的所有内容！
let data = {
  tools: [
    {
      id: "program_integration",
      title: "程序整合",
      content: "这里放你要写的详细步骤...",
      videoUrl: ""
    }
  ]
};

// 获取所有功能（APP 首页用）
app.get('/api/tools', (req, res) => {
  res.json(data.tools);
});

// 获取详情（APP 点进去用）
app.get('/api/tools/:id', (req, res) => {
  const tool = data.tools.find(t => t.id === req.params.id);
  res.json(tool || {});
});

// 端口
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("服务已启动");
});
