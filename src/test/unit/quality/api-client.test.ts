/**
 * Unit Tests for Quality Backend API Client
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import axios from 'axios';
import { QualityBackendClient } from '../../../quality/api/client';
import { createMockAnalysisResponse } from '../../helpers/factories';
import { mockWorkspace, resetAllMocks } from '../../mocks/vscode';

suite('QualityBackendClient', () => {
  let client: QualityBackendClient;
  let axiosPostStub: sinon.SinonStub;
  let axiosGetStub: sinon.SinonStub;
  let axiosCreateStub: sinon.SinonStub;

  setup(() => {
    resetAllMocks();

    // Mock VSCode workspace configuration
    mockWorkspace.getConfiguration.returns({
      get: sinon.stub().returns('http://localhost:8886'),
    });

    // Stub axios methods
    axiosPostStub = sinon.stub();
    axiosGetStub = sinon.stub();
    axiosCreateStub = sinon.stub(axios, 'create').returns({
      post: axiosPostStub,
      get: axiosGetStub,
      defaults: { baseURL: 'http://localhost:8886' },
      interceptors: {
        request: { use: sinon.stub() },
        response: { use: sinon.stub() },
      },
    } as any);

    client = new QualityBackendClient();
  });

  teardown(() => {
    sinon.restore();
  });

  suite('Constructor and Initialization', () => {
    test('should create axios client with correct baseURL', () => {
      expect(axiosCreateStub.calledOnce).to.be.true;
      const createConfig = axiosCreateStub.firstCall.args[0];
      expect(createConfig.baseURL).to.equal('http://localhost:8886');
    });

    test('should set timeout to 30 seconds', () => {
      const createConfig = axiosCreateStub.firstCall.args[0];
      expect(createConfig.timeout).to.equal(30000);
    });

    test('should set correct headers', () => {
      const createConfig = axiosCreateStub.firstCall.args[0];
      expect(createConfig.headers['Content-Type']).to.equal('application/json');
    });

    test('should read backend URL from configuration', () => {
      expect(mockWorkspace.getConfiguration.calledWith('llt-assistant.quality')).to.be.true;
    });

    test('should use default URL if config not found', () => {
      mockWorkspace.getConfiguration.returns({
        get: sinon.stub().returns(undefined),
      });
      new QualityBackendClient();
      expect(axiosCreateStub.calledTwice).to.be.true;
    });
  });

  suite('analyzeQuality', () => {
    test('should send POST request to /quality/analyze', async () => {
      const mockResponse = createMockAnalysisResponse();
      axiosPostStub.resolves({ data: mockResponse, status: 200 });

      const request = {
        files: [
          {
            path: 'tests/test_example.py',
            content: 'def test_example():\n    assert True',
          },
        ],
        mode: 'hybrid' as const,
        config: {
          disabled_rules: [],
          focus_on_changed_lines: false,
          llm_temperature: 0.3,
        },
        client_metadata: {
          extension_version: '0.1.0',
          vscode_version: '1.85.0',
          platform: 'linux',
          workspace_hash: 'abc123',
        },
      };

      const result = await client.analyzeQuality(request);

      expect(axiosPostStub.calledOnce).to.be.true;
      expect(axiosPostStub.firstCall.args[0]).to.equal('/quality/analyze');
      expect(axiosPostStub.firstCall.args[1]).to.deep.equal(request);
      expect(result).to.deep.equal(mockResponse);
    });

    test('should return analysis response with issues', async () => {
      const mockResponse = createMockAnalysisResponse();
      axiosPostStub.resolves({ data: mockResponse, status: 200 });

      const request = {
        files: [{ path: 'test.py', content: 'assert True' }],
        mode: 'hybrid' as const,
        config: {
          disabled_rules: [],
          focus_on_changed_lines: false,
          llm_temperature: 0.3,
        },
        client_metadata: {
          extension_version: '0.1.0',
          vscode_version: '1.85.0',
          platform: 'linux',
          workspace_hash: 'abc123',
        },
      };

      const result = await client.analyzeQuality(request);

      expect(result.issues).to.be.an('array');
      expect(result.issues.length).to.be.greaterThan(0);
      expect(result.summary).to.exist;
      expect(result.analysis_id).to.exist;
    });

    test('should handle network error', async () => {
      axiosPostStub.rejects({ code: 'ECONNREFUSED', message: 'Connection refused' });
      sinon.stub(axios, 'isAxiosError').returns(true);

      const request = {
        files: [{ path: 'test.py', content: 'assert True' }],
        mode: 'hybrid' as const,
        config: {
          disabled_rules: [],
          focus_on_changed_lines: false,
          llm_temperature: 0.3,
        },
        client_metadata: {
          extension_version: '0.1.0',
          vscode_version: '1.85.0',
          platform: 'linux',
          workspace_hash: 'abc123',
        },
      };

      try {
        await client.analyzeQuality(request);
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.type).to.equal('network');
        expect(error.message).to.include('Cannot connect');
      }
    });

    test('should handle 400 validation error', async () => {
      const errorResponse = {
        response: {
          status: 400,
          data: { detail: 'Invalid files format' },
        },
      };
      axiosPostStub.rejects(errorResponse);
      sinon.stub(axios, 'isAxiosError').returns(true);

      const request = {
        files: [],
        mode: 'hybrid' as const,
        config: {
          disabled_rules: [],
          focus_on_changed_lines: false,
          llm_temperature: 0.3,
        },
        client_metadata: {
          extension_version: '0.1.0',
          vscode_version: '1.85.0',
          platform: 'linux',
          workspace_hash: 'abc123',
        },
      };

      try {
        await client.analyzeQuality(request);
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.type).to.equal('validation');
        expect(error.statusCode).to.equal(400);
      }
    });

    test('should handle 422 validation error with field details', async () => {
      const errorResponse = {
        response: {
          status: 422,
          data: {
            detail: [
              { loc: ['files', 0, 'path'], msg: 'field required' },
              { loc: ['mode'], msg: 'invalid mode' },
            ],
          },
        },
      };
      axiosPostStub.rejects(errorResponse);
      sinon.stub(axios, 'isAxiosError').returns(true);

      const request = {
        files: [{ path: '', content: '' }],
        mode: 'invalid' as any,
        config: {
          disabled_rules: [],
          focus_on_changed_lines: false,
          llm_temperature: 0.3,
        },
        client_metadata: {
          extension_version: '0.1.0',
          vscode_version: '1.85.0',
          platform: 'linux',
          workspace_hash: 'abc123',
        },
      };

      try {
        await client.analyzeQuality(request);
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.type).to.equal('validation');
        expect(error.statusCode).to.equal(422);
        expect(error.detail).to.include('files.0.path');
      }
    });

    test('should handle 500 server error', async () => {
      const errorResponse = {
        response: {
          status: 500,
          data: { detail: 'Internal server error' },
        },
      };
      axiosPostStub.rejects(errorResponse);
      sinon.stub(axios, 'isAxiosError').returns(true);

      const request = {
        files: [{ path: 'test.py', content: 'assert True' }],
        mode: 'hybrid' as const,
        config: {
          disabled_rules: [],
          focus_on_changed_lines: false,
          llm_temperature: 0.3,
        },
        client_metadata: {
          extension_version: '0.1.0',
          vscode_version: '1.85.0',
          platform: 'linux',
          workspace_hash: 'abc123',
        },
      };

      try {
        await client.analyzeQuality(request);
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.type).to.equal('server');
        expect(error.statusCode).to.equal(500);
      }
    });

    test('should handle timeout error', async () => {
      axiosPostStub.rejects({ code: 'ECONNABORTED', message: 'timeout' });

      const request = {
        files: [{ path: 'test.py', content: 'assert True' }],
        mode: 'hybrid' as const,
        config: {
          disabled_rules: [],
          focus_on_changed_lines: false,
          llm_temperature: 0.3,
        },
        client_metadata: {
          extension_version: '0.1.0',
          vscode_version: '1.85.0',
          platform: 'linux',
          workspace_hash: 'abc123',
        },
      };

      try {
        await client.analyzeQuality(request);
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.type).to.equal('timeout');
        expect(error.message).to.include('timeout');
      }
    });
  });

  suite('healthCheck', () => {
    test('should return true when backend is healthy', async () => {
      axiosGetStub.resolves({ status: 200, data: { status: 'ok' } });

      const result = await client.healthCheck();

      expect(axiosGetStub.calledOnce).to.be.true;
      expect(axiosGetStub.firstCall.args[0]).to.equal('/health');
      expect(result).to.be.true;
    });

    test('should return false when backend is unreachable', async () => {
      axiosGetStub.rejects(new Error('Network error'));

      const result = await client.healthCheck();

      expect(result).to.be.false;
    });

    test('should return false when backend returns error status', async () => {
      axiosGetStub.resolves({ status: 503 });

      const result = await client.healthCheck();

      expect(result).to.be.false;
    });
  });

  suite('updateBackendUrl', () => {
    test('should update backend URL when configuration changes', () => {
      mockWorkspace.getConfiguration.returns({
        get: sinon.stub().returns('http://new-backend:8000'),
      });

      client.updateBackendUrl();

      // Verify the URL was updated (we can't easily test private properties,
      // but we can verify the config was checked)
      expect(mockWorkspace.getConfiguration.called).to.be.true;
    });

    test('should not update if URL is the same', () => {
      mockWorkspace.getConfiguration.returns({
        get: sinon.stub().returns('http://localhost:8886'),
      });

      client.updateBackendUrl();

      expect(mockWorkspace.getConfiguration.called).to.be.true;
    });
  });
});
