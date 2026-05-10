
module.exports = {
   apps : [

      {
         name: "selommes",
         script: "./src/app.js",
         watch: false,
         node_args: "--experimental-strip-types",
      },

   ]
}
