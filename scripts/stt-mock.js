const express = require("express");
const multer = require("multer");
const app = express();
const upload = multer();
app.post("/stt", upload.single("file"), (req,res)=> res.json({ text: "Dictado simulado: paciente estable; pendientes curación y analgesia" }));
app.listen(8091, ()=> console.log("STT mock en http://0.0.0.0:8091/stt"));
