module.exports = {
  apps : [{
    name: 'libconnected',	  
    script: 'index.js',
    watch: ['index.js', 'src', 'config.yaml'],
    ignore_watch: ['node_modules', '.*'],
    args: [
      '--color'
    ]
  }]
};
