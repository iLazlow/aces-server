const moment = require('moment');
const sqlite3 = require('sqlite3')
const { SERVER_NAME, PORT } = require('./config.json');
const fs = require('fs');
const cors = require("cors");
const DAO = require('./dao');
const path = require("path");
const sharp = require("sharp");
const crypto = require('crypto');
const multer = require("multer");
const express = require('express');
const bodyParser = require('body-parser');
const { emitWarning } = require('process');

const app = express();
const dao = new DAO('./main.db');
const wss = require('express-ws')(app);
const upload = multer({
  dest: "./avatar/"
});

app.use(cors());
app.use(bodyParser.json({limit: '100mb'}));
app.use(bodyParser.urlencoded({
  extended: true,
  limit: '100mb'
}));
app.use(function (req, res, next) {
  //console.log('middleware');
  //req.testing = 'testing';
  return next();
});


app.ws('/', function(ws, req) {
  ws.user = req.query.user;
  ws.hash = req.query.hash;
  dao.get("SELECT * FROM accounts WHERE username LIKE '%" + ws.user + "%'").then(result => {
    //console.log("SELECT * FROM accounts WHERE username LIKE '%" + ws.user + "%'");
    //console.log(result);
    if(result != undefined && result.password == ws.hash){
      //console.log(result + " != undefined &&  " + result.password + " == " + ws.hash);
      dao.all("SELECT * FROM message_queue WHERE recipient = ? ORDER BY created ASC", [ws.user]).then(result => {
        //console.log(result.length);
        if(result.length > 0){
          console.log("found messages for " + ws.user);
          result.forEach(function(msg) {
            console.log("send msg " + msg.id);
            ws.send(JSON.stringify({type: "message", msg: {message_uuid: msg.message_uuid, sender: msg.sender, recipient: msg.recipient, content: msg.content, signature: msg.signature, created: msg.created}}));
            dao.run('DELETE FROM message_queue WHERE id = ?', [msg.id]);
          });
        }
      });
    }
  });
  
  ws.on('message', function message(data) {
    const json = JSON.parse(data);

    if(json.type == "msg"){
      console.log(`send message from ${json.sender} to ${json.recipient}`);
      var i = 0;
      wss.getWss().clients.forEach(function(client) {
        if(client.user == json.recipient){
          client.send(JSON.stringify({type: "message", msg: {message_uuid: json.message_uuid, sender: json.sender, recipient: json.recipient, content: json.content, signature: json.signature, created: json.created}}));
          i++;
        }
      });
      if(i == 0){
        console.log("no client found. save in database for later");
        dao.run('INSERT INTO message_queue (message_uuid, sender, recipient, content, signature, created) VALUES (?, ?, ?, ?, ?, ?)', [json.message_uuid, json.sender, json.recipient, json.content, json.signature, json.created]);
        //TODO: implement notifications
      }
    }else if(json.type == "mark_read"){
      wss.getWss().clients.forEach(function(client) {
        if(client.user == json.sender){
          console.log(`mark message ${json.message_uuid} as read`);
          client.send(JSON.stringify({type: "mark_read", message_uuid: json.message_uuid, sender: json.sender, recipient: json.recipient}));
        }
      });
    }else if(json.type == "online_status"){
      var i = 0;
      wss.getWss().clients.forEach(function(client) {
        if(client.user == json.user){
          console.log(`${json.user} is connected`);
          ws.send(JSON.stringify({type: "online_status", online: true, user: json.user}));
          i++;
        }
      });
      if(i == 0){
        ws.send(JSON.stringify({type: "online_status", online: false, user: json.user}));
      }
    }else{
      ws.send(JSON.stringify({type: "error", msg: "Unknown action"}));
    }
  });

  ws.send(JSON.stringify({type: "connected", key: ws.user}));
});

/* Server Endpoints */
app.get("/", (req, res) => res.send(`${SERVER_NAME} is working!`));

app.post('/checkin', (req, res) => {
  dao.get("SELECT * FROM accounts WHERE username LIKE '%" + req.body.username + "%'").then(result => {
    console.log(result);
    if(result == undefined){
      res.send({status: "success", type: "CREATED", serverName: SERVER_NAME, message: "Account with username " + req.body.username + " created"});
      dao.run('INSERT INTO accounts (username, password, created, key) VALUES (?, ?, ?, ?)', [req.body.username, req.body.password, moment(new Date()).format('YYYY-MM-DD HH:mm:ss'), req.body.public]);
    }else{
      if(result.password == req.body.password){
        res.send({status: "success", type: "LOGIN", serverName: SERVER_NAME, message: "Account with username " + req.body.username + " found"});
        dao.run('UPDATE accounts SET key = ? WHERE id = ?', [req.body.public, result.id]);
      }else{
        res.send({status: "error", type: "WRONG_CREDENTIALS", serverName: SERVER_NAME, message: "Your username or password is invalid"});
      }
    }
  });
});

app.post('/upload/avatar', upload.single("files"), async (req, res, next) => {
  dao.get("SELECT * FROM accounts WHERE username LIKE '%" + req.query.user + "%'").then(result => {
    if(result == undefined){
      res.send({status: "error", type: "USER_NOT_FOUND", message: "Account with username " + req.query.user + " was not found"});
    }else{
      if(result.password == req.query.hash){
        //console.log(req.file);
        
        //remove old avatar if exists
        if(result.avatar != null && result.avatar != undefined && result.avatar != ""){
          //console.log(result.avatar);
          //console.log("old avatar found. remove");
          fs.unlink(`.${result.avatar}`, (err) => {
            if(err){
              fs.unlink(`${req.file.path}`, () => {});
            }
            //console.log('successfully deleted ' + result.avatar);
          });
        }

        let filename = crypto.createHash('md5').update(`${result.username}:${Math.floor(new Date().getTime()/1000)}`).digest('hex');
        let extension = ".webp"; //path.extname(req.file.originalname).toLowerCase();
        let avatar_path = `/avatar/${filename}${extension}`;
        fs.rename(req.file.path, `.${avatar_path}`, (err) => {
          if(err){
            fs.unlink(`${req.file.path}`, () => {});
          }
          await sharp(req.file.buffer).webp({ quality: 20 }).toFile(`.${avatar_path}`);

          //console.log(`${req.file.originalname} was saved as ${filename}${extension}`);
          dao.run('UPDATE accounts SET avatar = ? WHERE id = ?', [avatar_path, result.id]);
          res.send({status: "success", type: "UPLOAD", message: "Avatar was uploaded successfully"});
        });
      }else{
        res.send({status: "error", type: "WRONG_CREDENTIALS", message: "Your username or password is invalid"});
      }
    }
  });
});

app.get('/avatar/:filename', (req, res) => {
  res.sendFile(`${__dirname}/avatar/${req.params.filename}`, (err) => {
    if (err) {
      res.send({status: "error", type: "FILE_NOT_FOUND", message: "The file was not found"});
    }
  });
});

app.get('/search/:username', (req, res) => {
  dao.all("SELECT * FROM accounts WHERE username LIKE '%" + req.params.username + "%'").then(result => {
    var users = [];
    result.forEach(function(user) {
      users.push({id: user.id, username: String(user.username), avatar: String(user.avatar), publicKey: String(user.key)});
    });
    res.send({status: "success", type: "SEARCH", users: users});
  });
});

app.get('/user/byId/:id', (req, res) => {
  dao.get("SELECT * FROM accounts WHERE id = '" + req.params.id + "'").then(result => {
    if(result != undefined){
      res.send({status: "success", type: "USER_FOUND", user: {id: result.id, username:String( result.username), avatar: String(result.avatar), publicKey: String(result.key)}});
    }else{
      res.send({status: "error", type: "USER_NOT_FOUND", message: "There was no user found with this id."});
    }
  });
});

app.get('/user/byName/:username', (req, res) => {
  dao.get("SELECT * FROM accounts WHERE username = '" + req.params.username + "'").then(result => {
    if(result != undefined){
      res.send({status: "success", type: "USER_FOUND", user: {id: result.id, username:String( result.username), avatar: String(result.avatar), publicKey: String(result.key)}});
    }else{
      res.send({status: "error", type: "USER_NOT_FOUND", message: "There was no user found with this id."});
    }
  });
});

app.listen(PORT, () => console.log(`Aces Server listening on port ${PORT}!`));