const moment = require('moment');
const sqlite3 = require('sqlite3')
const { WEB_PORT, WSS_PORT } = require('./config.json');
const fs = require('fs');
const cors = require("cors");
const DAO = require('./dao');
const express = require('express');
const {WebSocketServer} = require('ws');
const bodyParser = require('body-parser');

const dao = new DAO('./main.db');
const app = express();
app.use(cors());
app.use(bodyParser.json());

const wss = new WebSocketServer({port: WSS_PORT});
wss.on('connection', function connection(ws, req) {
  const query = req.url.split('|')[1];
  ws.publicKey = query;
  //go trough holded messages and send them to new client
  dao.all("SELECT * FROM message_queue WHERE recipient = ? ORDER BY created ASC", [ws.publicKey]).then(result => {
    //console.log(result);
    if(result.length > 0){
      console.log("found messages for " + ws.publicKey);
      result.forEach(function(msg) {
        console.log("send msg " + msg.id);
        ws.send(JSON.stringify({type: "message", msg: msg.content, created: msg.created}));
        dao.run('DELETE FROM message_queue WHERE id = ?', [msg.id]);
      });
    }
  });


  ws.on('message', function message(data) {
    const json = JSON.parse(data);

    if(json.type == "msg"){
      console.log(`send message from ${json.sender} to ${json.recipient}`);
      var i = 0;
      wss.clients.forEach(function(client) {
        if(client.publicKey == json.recipient){
          client.send(JSON.stringify({type: "message", msg: json.content, created: moment(new Date()).format('YYYY-MM-DD HH:mm:ss')}));
          i++;
        }
      });
      if(i == 0){
        console.log("no client found. save in database for later");
        dao.run('INSERT INTO message_queue (sender, recipient, content, created) VALUES (?, ?, ?, ?)', [json.sender, json.recipient, json.content, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')]);
      }
    }else{
      ws.send(JSON.stringify({type: "error", msg: "Unknown action"}));
    }
  });

  ws.send(JSON.stringify({type: "connected"}));
});

/* Server Endpoints */
app.get("/", (req, res) => res.send("Aces Server is working!"));

app.post('/checkin', (req, res) => {
  dao.get("SELECT * FROM accounts WHERE username = ?", [req.body.username]).then(result => {
    console.log(result);
    if(result == undefined){
      res.send({status: "success", type: "CREATED", message: "Account with username " + req.body.username + " created"});
      dao.run('INSERT INTO accounts (username, password, created, key) VALUES (?, ?, ?, ?)', [req.body.username, req.body.password, moment(new Date()).format('YYYY-MM-DD HH:mm:ss'), req.body.public]);
    }else{
      if(result.username == req.body.username && result.password == req.body.password){
        res.send({status: "success", type: "LOGIN", message: "Account with username " + req.body.username + " found"});
        dao.run('UPDATE accounts SET key = ? WHERE username = ?', [req.body.public, req.body.username]);
      }else{
        res.send({status: "error", type: "WRONG_CREDENTIALS", message: "Your username or password is invalid"});
      }
    }
  });
});

app.listen(WEB_PORT, () => console.log(`Aces Server listening on port ${WEB_PORT}!`));