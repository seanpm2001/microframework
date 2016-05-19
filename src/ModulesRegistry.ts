import {Container} from "typedi/typedi";
import {MicroFrameworkConfig} from "./MicroFrameworkConfig";
import {MicroFrameworkSettings} from "./MicroFrameworkSettings";
import {MicroFrameworkUtils} from "./MicroFrameworkUtils";
import {Configurator} from "configuration-manager/Configurator";
import {Module, ModuleInitOptions} from "./Module";
import {DependenciesMissingException} from "./exception/DependenciesMissingException";
import {ModuleConfigurationMissingException} from "./exception/ModuleConfigurationMissingException";
import {ModuleProblemsException} from "./exception/ModuleProblemsException";
import {NoModulesLoadedException} from "./exception/NoModulesLoadedException";
import {ModuleAlreadyRegisteredException} from "./exception/ModuleAlreadyRegisteredException";
import {ModuleWithoutNameException} from "./exception/ModuleWithoutNameException";
import {MicroFrameworkBootstrapper} from "./MicroFrameworkBootstrapper";

/**
 * Registry for framework modules.
 */
export class ModuleRegistry {

    // -------------------------------------------------------------------------
    // Properties
    // -------------------------------------------------------------------------

    private modules: Module[] = [];

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(private settings: MicroFrameworkSettings,
                private configuration: MicroFrameworkConfig,
                private configurator: Configurator,
                private microframework: MicroFrameworkBootstrapper) {
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Registers all given modules in the framework.
     */
    registerModules(modules: Module[]) {
        modules.forEach(mod => this.registerModule(mod));
    }

    /**
     * Registers a new module in the framework.
     */
    registerModule(module: Module) {
        if (!module.getName())
            throw new ModuleWithoutNameException(module);

        let moduleWithSameName = this.modules.reduce((found, mod) => mod.getName() === module.getName() ? mod : found, undefined);
        if (moduleWithSameName)
            throw new ModuleAlreadyRegisteredException(module.getName());

        this.modules.push(module);
    }

    /**
     * Finds a module with given type registered in the registry.
     */
    findModuleByType(type: Function): Module {
        return this.modules.reduce((found, module) => module instanceof type ? module : found, undefined);
    }
    
    /**
     * Finds a module with given type registered in the registry.
     */
    findModuleByName(name: string): Module {
        return this.modules.find(module => module.getName() === name);
    }

    /**
     * Bootstraps all modules.
     */
    bootstrapAllModules(): Promise<void> {
        if (this.modules.length === 0)
            throw new NoModulesLoadedException();

        // sort modules in a
        try {
            MicroFrameworkUtils.sortModulesByDependencies(this.modules);

        } catch (error) {
            throw new ModuleProblemsException(error.message ? error.message : "");
        }

        this.modules.forEach(mod => {
            const config: ModuleInitOptions = {
                frameworkSettings: MicroFrameworkUtils.deepClone<MicroFrameworkSettings>(this.settings),
                debugMode: this.configuration.debugMode || false,
                container: Container
            };
            mod.init(config, this.findConfigurationForModule(mod), this.findDependantModulesForModule(mod), this.microframework);
        });

        if (this.configuration.bootstrap && this.configuration.bootstrap.timeout > 0) {
            return new Promise<void>((ok, fail) => {
                setTimeout(() => ok(this.bootstrapModules()), this.configuration.bootstrap.timeout);
            });
        }

        return this.bootstrapModules();
    }

    /**
     * Shutdowns all modules.
     */
    shutdownAllModules(): Promise<void> {
        return Promise.all(this.modules.map(mod => mod.onShutdown()))
            .then(() => {});
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private bootstrapModules(): Promise<void> {
        return Promise.all(this.modules.map(mod => mod.onBootstrap()))
            .then(() => Promise.all(this.modules.map(module => module.afterBootstrap ? module.afterBootstrap() : undefined)))
            .then(() => {})
            .catch(err => {

                // we need to catch any kind of error in the shutdown and provide original error instead, 
                // because otherwise if shutdown will fail user will not know about orignal issue
                try {
                    return this.shutdownAllModules()
                        .then(function () { throw err; })
                        .catch(function () { throw err; });
                } catch (errorInShutdown) {
                    throw err;
                }
            });
    }

    private findConfigurationForModule(module: Module): any {
        if (!module.getConfigurationName || !module.getConfigurationName())
            return undefined;

        let config = this.configurator.get(module.getConfigurationName());
        if (!config && module.isConfigurationRequired && module.isConfigurationRequired())
            throw new ModuleConfigurationMissingException(module.getName());

        return config;
    }

    private findDependantModulesForModule(module: Module): Module[] {
        if (!module.getDependentModules || !module.getDependentModules() || !module.getDependentModules().length)
            return undefined;

        let missingDependantModuleNames: string[] = [];
        let dependantModules = module.getDependentModules().map(dependantModuleName => {
            let dependantModule = this.modules.reduce((found, mod) => mod.getName() === dependantModuleName ? mod : found, undefined);
            if (!dependantModule)
                missingDependantModuleNames.push(dependantModuleName);

            return dependantModule;
        });

        if (!module.ignoreMissingDependencies && missingDependantModuleNames.length > 0)
            throw new DependenciesMissingException(module.getName(), missingDependantModuleNames);

        return dependantModules;
    }

}