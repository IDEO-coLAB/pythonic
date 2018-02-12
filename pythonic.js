const net = require('net');
const randomstring = require('randomstring');
const spawn = require('child_process').spawn;
const debug = require('debug')('pythonic');


class Pythonic {
  constructor(pyModules=[], cwd='.'){
    this.startPython = this.startPython.bind(this);
    this.openSocket = this.openSocket.bind(this);
    this.callPython = this.callPython.bind(this);
    this.handlePythonData = this.handlePythonData.bind(this);
    this.importModules = this.importModules.bind(this);
    this.getCallables = this.getCallables.bind(this);
    this.onReady = this.onReady.bind(this);

    this.pythonUp = false;
    this.pythonProcesses = {};
    this.run = {};

    this.startPython(cwd).then(()=>{
      this.openSocket().then(()=>{
        this.importModules(pyModules).then(()=>{
          if(this.readyCallback){
            this.readyCallback()
          }
        }).catch(error => console.log(error))
      }).catch(error => console.log(error))
    }).catch(error => console.log(error))

  }
  startPython(cwd){
    return new Promise((resolve, reject) => {
      debug('Starting Python');
      this.pythonProcess = spawn('python', ['pythonic.py'], {cwd});

      this.pythonProcess.stderr.on('data', (error) => {
        console.error('PYTHON:', error.toString());
      });

      this.pythonProcess.stdout.on('data', (data) => {
        if(data.toString().includes('PYTHONIC_UP')){
          resolve();
        }
        debug('PYTHON:', data.toString());
      });
    })


  }
  openSocket(){
    return new Promise((resolve, reject) => {
      this.pythonSocket = new net.Socket();
      this.pythonSocket.connect(1234, '127.0.0.1', () => {
        debug('Connected');
        resolve();
      });

      this.pythonSocket.on('data', (data) => {
        debug('Received: ' + data);
        this.handlePythonData(data.toString());
      });

      this.pythonSocket.on('close', () => {
        debug('Connection closed');
      });
    })
  }

  handlePythonData(data){
    const res = JSON.parse(data);
    const openProcess = this.pythonProcesses[res.pid];
    if(openProcess){
      res.status === 'OK' ? openProcess.resolve(res.body) : openProcess.reject(res.body);
      delete this.pythonProcesses[res.pid]
    }
  }

  importModules(modules){
    return new Promise((resolve, reject) => {
      modules.forEach(module => {
        this.callPython({
          action: 'IMPORT',
          module
        })
        .then(moduleTree => {
          this.run[module] = this.getCallables(moduleTree, module);
          resolve();
        })
        .catch(reject)
      })
    });
  }

  getCallables(moduleTree, treeLoc){
    return moduleTree.reduce((result, element) => {
      const isFunc = typeof element === 'string';
      const modName = treeLoc ? treeLoc : '';
      if(isFunc){
        result[element] = (args=[], kwargs={}) => {
          return this.callPython({
            action: 'RUN',
            module: modName,
            function: element,
            args,
            kwargs
          })
        }
      }else{
        const subModName = Object.keys(element)[0];
        result[subModName] = this.getCallables(element[subModName], `${modName}.${subModName}`)
      }
      return result;
    }, {})
  }

  onReady(callback){
    this.readyCallback = callback;
  }

  callPython(request){
    const pid = randomstring.generate(5);
    const fullRequest = JSON.stringify(Object.assign(request, {pid}));
    debug(`Sending: ${fullRequest}`);
    this.pythonSocket.write(fullRequest);
    return new Promise((resolve, reject)=>{
       this.pythonProcesses[pid] = {resolve, reject}
    })
  }
}

module.exports = Pythonic;