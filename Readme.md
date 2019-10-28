# RDS Monitoring Lambda

## ENV VARS

Support is provided through [cfg](https://github.com/smartprix/cfg) module. It reads values from `config.js`, but they can be overwritten with another `config.js` in the `private` folder in the project root. Or through env vars in this format:

```sh
# Overwriting password (db.password):
CFG__DB__PASSWORD='password' yarn start
# Adding host to posiition 1 (hosts.1):
CFG__DB__HOSTS__1='new-host.region.rds.amazonaws.com'
```

It basically uses lodash.set internally. The path is generated by removing the `CFG__` prefix and replacing `__` with `.` and converting to camelCase (also through lodash).
 